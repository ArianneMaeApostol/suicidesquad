/**
 * @file pages/deliveries.js
 * Controller for deliveries.html: Kanban dispatch board, live updates,
 * customer trip booking, rider assignment, active rider load tracking,
 * barangay filtering, and status transitions.
 */
import {
  resolveBranchId,
  getDeliveries,
  getRiders,
  getCustomers,
  createDelivery,
  assignDeliveryRider,
  rpcSetDeliveryStatus,
  subscribeDeliveries
} from '../api.js';

import {
  formatPHP,
  formatDate,
  escapeHTML,
  showToast,
  setButtonLoading,
  openModal,
  closeModal
} from '../ui.js';

let activeBranchId = null;
let currentProfile = null;
let realtimeChannel = null;
let ridersList = [];
let customersList = [];
let deliveriesList = [];
let selectedBarangay = 'all';

export async function init({ profile }) {
  currentProfile = profile;
  activeBranchId = await resolveBranchId();

  const riderFilterId = profile.role === 'rider' ? profile.id : null;

  // 1. Load riders
  await loadRiders();

  // 2. Load customer accounts for booking modal
  await loadCustomerOptions();

  // 3. Load Initial Deliveries
  await fetchAndRenderDeliveries(riderFilterId);

  // 4. Setup Barangay Filter
  setupBarangayFilter();

  // 5. Setup Trip Booking Modal
  setupNewTripModal();

  // 6. Setup Realtime SSE Channel
  try {
    realtimeChannel = subscribeDeliveries(activeBranchId, () => {
      fetchAndRenderDeliveries(riderFilterId);
    });
  } catch (err) {
    console.warn('Realtime deliveries connection:', err);
  }

  window.addEventListener('beforeunload', () => {
    if (realtimeChannel && typeof realtimeChannel.unsubscribe === 'function') {
      realtimeChannel.unsubscribe();
    }
  });
}

/**
 * Loads delivery riders and populates modal + active riders bar.
 */
async function loadRiders() {
  const { data: riders } = await getRiders(activeBranchId);
  ridersList = riders || [];

  // Populate #del-rider dropdown
  const riderSelect = document.getElementById('del-rider');
  if (riderSelect) {
    riderSelect.innerHTML = `
      <option value="">Unassigned (Queue in Pending)</option>
      ${ridersList
        .map(
          (r) => `
        <option value="${escapeHTML(r.id)}">${escapeHTML(r.full_name)} (${r.phone || 'Active Rider'})</option>
      `
        )
        .join('')}
    `;
  }

  updateActiveRidersBar();
}

/**
 * Updates the active riders toolbar bar with their current in-flight delivery count.
 */
function updateActiveRidersBar() {
  const container = document.getElementById('active-riders-container');
  if (!container) return;

  if (ridersList.length === 0) {
    container.innerHTML = `
      <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted);">Active Riders:</span>
      <span class="badge badge-neutral">No riders registered</span>
    `;
    return;
  }

  const riderBadges = ridersList.map((r) => {
    const activeCount = deliveriesList.filter(
      (d) => d.rider_id === r.id && (d.status === 'assigned' || d.status === 'out_for_delivery')
    ).length;
    const badgeClass = activeCount > 0 ? 'badge-success' : 'badge-neutral';
    return `<span class="badge ${badgeClass}" title="${r.phone || ''}">${escapeHTML(r.full_name)} (${activeCount} active)</span>`;
  });

  container.innerHTML = `
    <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted);">Active Riders:</span>
    ${riderBadges.join(' ')}
  `;
}

/**
 * Loads registered customers for the booking modal.
 */
async function loadCustomerOptions() {
  const custSelect = document.getElementById('del-cust');
  if (!custSelect) return;

  const { data: customers } = await getCustomers({ pageSize: 100 });
  customersList = customers || [];

  custSelect.innerHTML = `
    <option value="">Select or search customer account...</option>
    ${customersList
      .map((c) => {
        const addr = [c.address, c.barangay].filter(Boolean).join(', ');
        return `<option value="${escapeHTML(c.id)}" data-barangay="${escapeHTML(c.barangay || '')}">
          ${escapeHTML(c.full_name)} (${escapeHTML(addr || 'Station Area')}) [${(c.type || 'regular').toUpperCase()}]
        </option>`;
      })
      .join('')}
  `;
}

/**
 * Fetches deliveries and distributes them into the Kanban columns.
 * @param {string|null} riderFilterId
 */
async function fetchAndRenderDeliveries(riderFilterId) {
  const { data: orders, error } = await getDeliveries({
    branchId: activeBranchId,
    riderId: riderFilterId
  });

  if (error) {
    showToast('Failed to load dispatch board.', 'danger');
    return;
  }

  deliveriesList = orders || [];
  updateBarangayFilterOptions();
  renderKanbanColumns();
  updateActiveRidersBar();
  updateSidebarBadge();
}

/**
 * Populates barangay filter options based on available orders and customers.
 */
function updateBarangayFilterOptions() {
  const filterSelect = document.getElementById('barangay-filter');
  if (!filterSelect) return;

  const barangays = new Set();
  deliveriesList.forEach((d) => {
    const b = d.barangay || d.customers?.barangay;
    if (b) barangays.add(b.trim());
  });

  const currentVal = filterSelect.value;
  filterSelect.innerHTML = `
    <option value="all">All Barangays</option>
    ${Array.from(barangays)
      .sort()
      .map((b) => `<option value="${escapeHTML(b)}" ${currentVal === b ? 'selected' : ''}>${escapeHTML(b)}</option>`)
      .join('')}
  `;
}

function setupBarangayFilter() {
  const filterSelect = document.getElementById('barangay-filter');
  if (!filterSelect) return;

  filterSelect.addEventListener('change', (e) => {
    selectedBarangay = e.target.value;
    renderKanbanColumns();
  });
}

function updateSidebarBadge() {
  const badge = document.querySelector('.nav-link[href="deliveries.html"] .nav-badge');
  if (!badge) return;

  const activeCount = deliveriesList.filter(
    (d) => d.status === 'pending' || d.status === 'assigned' || d.status === 'out_for_delivery'
  ).length;

  badge.textContent = activeCount;
  badge.className = `nav-badge ${activeCount > 0 ? 'danger' : 'neutral'}`;
}

/**
 * Renders the Kanban columns: Pending, Assigned, Out for Delivery, Delivered.
 */
function renderKanbanColumns() {
  const colPending = document.querySelector('.kanban-cards[data-col="pending"]') || document.querySelectorAll('.kanban-col .kanban-cards')[0];
  const colAssigned = document.querySelector('.kanban-cards[data-col="assigned"]') || document.querySelectorAll('.kanban-col .kanban-cards')[1];
  const colOut = document.querySelector('.kanban-cards[data-col="out_for_delivery"]') || document.querySelectorAll('.kanban-col .kanban-cards')[2];
  const colDelivered = document.querySelector('.kanban-cards[data-col="delivered"]') || document.querySelectorAll('.kanban-col .kanban-cards')[3];

  if (!colPending || !colAssigned || !colOut || !colDelivered) return;

  const filtered = deliveriesList.filter((d) => {
    if (selectedBarangay === 'all') return true;
    const b = (d.barangay || d.customers?.barangay || '').toLowerCase();
    return b.includes(selectedBarangay.toLowerCase());
  });

  const grouped = {
    pending: filtered.filter((d) => d.status === 'pending'),
    assigned: filtered.filter((d) => d.status === 'assigned'),
    out_for_delivery: filtered.filter((d) => d.status === 'out_for_delivery'),
    delivered: filtered.filter((d) => d.status === 'delivered')
  };

  // Update column titles
  const titles = document.querySelectorAll('.kanban-col .kanban-title span:last-child');
  if (titles[0]) titles[0].textContent = `Pending Orders (${grouped.pending.length})`;
  if (titles[1]) titles[1].textContent = `Assigned to Rider (${grouped.assigned.length})`;
  if (titles[2]) titles[2].textContent = `Out for Delivery (${grouped.out_for_delivery.length})`;
  if (titles[3]) titles[3].textContent = `Delivered & Remitted (${grouped.delivered.length})`;

  colPending.innerHTML = renderCards(grouped.pending, 'pending');
  colAssigned.innerHTML = renderCards(grouped.assigned, 'assigned');
  colOut.innerHTML = renderCards(grouped.out_for_delivery, 'out_for_delivery');
  colDelivered.innerHTML = renderCards(grouped.delivered, 'delivered');

  bindCardActionEvents();
}

/**
 * Generates card HTML for a status group.
 */
function renderCards(list, status) {
  if (list.length === 0) {
    return `<div style="text-align: center; color: var(--text-muted); font-size: 0.78rem; padding: 24px 8px;">No ${status.replace(/_/g, ' ')} orders</div>`;
  }

  const isRider = currentProfile?.role === 'rider';

  return list
    .map((d) => {
      const orderCode = `#DEL-${d.id.slice(0, 5).toUpperCase()}`;
      const customerName = d.customer_name || d.customers?.full_name || 'Walk-in / Valued Customer';
      const address = d.delivery_address || d.customers?.address || 'Station Pasig';
      const barangay = d.barangay || d.customers?.barangay || '';
      const fullAddr = [address, barangay].filter(Boolean).join(', ');
      const riderName = d.rider_name || d.rider?.full_name || 'Unassigned';
      const gallonsCount = d.gallons || d.slim_count || 5;
      const orderAmount = Number(d.amount || d.total_amount || 0);

      let actionButtons = '';

      if (status === 'pending' && !isRider) {
        actionButtons = `
          <div style="margin-top: 10px;">
            <select class="form-control select-rider-dropdown" data-id="${d.id}" style="font-size: 0.78rem; padding: 5px;">
              <option value="">Assign Rider to Trip...</option>
              ${ridersList
                .map(
                  (r) => `<option value="${r.id}" ${d.rider_id === r.id ? 'selected' : ''}>${escapeHTML(r.full_name)}</option>`
                )
                .join('')}
            </select>
          </div>
        `;
      } else if (status === 'assigned') {
        actionButtons = `
          <div style="margin-top: 10px; display: flex; gap: 6px;">
            <button type="button" class="btn btn-primary btn-sm btn-block" data-action="set-status" data-id="${d.id}" data-status="out_for_delivery">
              Dispatch (Out) &rarr;
            </button>
            ${
              !isRider
                ? `<button type="button" class="btn btn-outline btn-sm" data-action="unassign" data-id="${d.id}" title="Unassign Rider">&times;</button>`
                : ''
            }
          </div>
        `;
      } else if (status === 'out_for_delivery') {
        actionButtons = `
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-success btn-sm btn-block" data-action="set-status" data-id="${d.id}" data-status="delivered" style="font-size: 0.82rem; padding: 7px;">
              &#10003; Delivered & Remit Cash
            </button>
          </div>
        `;
      }

      const isCredit = d.payment_method === 'credit';
      const isPaid = d.is_paid;
      const paymentBadge = isCredit
        ? '<span class="badge badge-warning">Credit / Utang</span>'
        : isPaid
        ? `<span class="badge badge-success">Paid (${(d.payment_method || 'cash').toUpperCase()})</span>`
        : '<span class="badge badge-neutral">COD Cash</span>';

      return `
        <div class="kanban-card" data-id="${d.id}" style="${
          status === 'out_for_delivery'
            ? 'border-left: 3px solid var(--primary);'
            : status === 'delivered'
            ? 'border-left: 3px solid var(--success);'
            : status === 'assigned'
            ? 'border-left: 3px solid var(--warning);'
            : ''
        }">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span class="delivery-id-tag">${escapeHTML(orderCode)}</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">${formatDate(d.created_at, true)}</span>
          </div>
          <div class="delivery-customer" style="font-weight: 700; margin-bottom: 4px;">${escapeHTML(customerName)}</div>
          <div class="delivery-address" style="margin-bottom: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHTML(fullAddr)}</span>
          </div>
          <div style="font-size: 0.8rem; margin-bottom: 6px;">
            <strong>${gallonsCount}x</strong> 5-Gal Refill
            ${d.notes ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Note: ${escapeHTML(d.notes)}</div>` : ''}
          </div>
          ${
            d.rider_id
              ? `<div style="background-color: var(--bg-surface-alt); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.74rem; margin-bottom: 6px;">
                  Rider: <strong>${escapeHTML(riderName)}</strong>
                </div>`
              : ''
          }
          <div class="delivery-footer">
            ${paymentBadge}
            <strong style="color: var(--primary);">${formatPHP(orderAmount)}</strong>
          </div>
          ${actionButtons}
        </div>
      `;
    })
    .join('');
}

/**
 * Binds status transition triggers and rider selector dropdowns.
 */
function bindCardActionEvents() {
  // 1. Rider selection
  document.querySelectorAll('.select-rider-dropdown').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const riderId = e.target.value;
      const deliveryId = sel.dataset.id;
      if (!riderId) return;

      sel.disabled = true;
      const { error } = await assignDeliveryRider(deliveryId, riderId);
      sel.disabled = false;

      if (error) {
        showToast(error.message || 'Failed to assign rider.', 'danger');
      } else {
        showToast('Rider assigned to delivery trip!', 'success');
        const riderFilterId = currentProfile?.role === 'rider' ? currentProfile.id : null;
        fetchAndRenderDeliveries(riderFilterId);
      }
    });
  });

  // 2. Unassign rider
  document.querySelectorAll('[data-action="unassign"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { id } = btn.dataset;
      setButtonLoading(btn, true);
      const { error } = await assignDeliveryRider(id, null);
      setButtonLoading(btn, false);

      if (error) {
        showToast(error.message || 'Failed to unassign rider.', 'danger');
      } else {
        showToast('Delivery returned to pending queue.', 'info');
        const riderFilterId = currentProfile?.role === 'rider' ? currentProfile.id : null;
        fetchAndRenderDeliveries(riderFilterId);
      }
    });
  });

  // 3. Status transitions
  document.querySelectorAll('[data-action="set-status"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { id, status } = btn.dataset;
      setButtonLoading(btn, true);

      const { error } = await rpcSetDeliveryStatus(id, status);
      setButtonLoading(btn, false);

      if (error) {
        showToast(error.message || 'Status update failed.', 'danger');
      } else {
        const statusLabel =
          status === 'out_for_delivery'
            ? 'dispatched out on route'
            : status === 'delivered'
            ? 'marked delivered & remitted'
            : status;
        showToast(`Trip ${statusLabel}!`, 'success');
        const riderFilterId = currentProfile?.role === 'rider' ? currentProfile.id : null;
        fetchAndRenderDeliveries(riderFilterId);
      }
    });
  });
}

/**
 * Handles booking new delivery trips.
 */
function setupNewTripModal() {
  const modal = document.getElementById('new-delivery-modal');
  const form = document.getElementById('new-delivery-form') || modal?.querySelector('form');
  if (!modal || !form) return;

  // Handle modal close buttons
  modal.querySelectorAll('[data-action="close-delivery-modal"], .modal-close-btn, a[href="#"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const custSelect = document.getElementById('del-cust');
    const qtyInput = document.getElementById('del-qty');
    const riderSelect = document.getElementById('del-rider');
    const paySelect = document.getElementById('del-pay');
    const notesInput = document.getElementById('del-notes');
    const submitBtn = form.querySelector('button[type="submit"]');

    const customerId = custSelect?.value;
    const gallons = parseInt(qtyInput?.value, 10) || 5;
    const riderId = riderSelect?.value || null;
    const paymentMethod = paySelect?.value || 'cod';
    const notes = notesInput?.value.trim() || null;

    if (!customerId) {
      showToast('Please select a customer account.', 'warning');
      if (custSelect) custSelect.focus();
      return;
    }

    if (gallons < 1) {
      showToast('Please enter at least 1 gallon.', 'warning');
      if (qtyInput) qtyInput.focus();
      return;
    }

    const selectedCustObj = customersList.find((c) => c.id === customerId);
    const customerName = selectedCustObj?.full_name || 'Customer';

    setButtonLoading(submitBtn, true, 'Booking Trip...');

    const { data: newDelivery, error } = await createDelivery({
      branch_id: activeBranchId,
      customer_id: customerId,
      rider_id: riderId,
      gallons,
      payment_method: paymentMethod,
      notes,
      address: selectedCustObj?.address || null,
      barangay: selectedCustObj?.barangay || null
    });

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Failed to book delivery trip.', 'danger');
      return;
    }

    form.reset();
    closeModal();

    showToast(`Delivery trip booked for ${customerName} (${gallons} gals)!`, 'success');

    const riderFilterId = currentProfile?.role === 'rider' ? currentProfile.id : null;
    fetchAndRenderDeliveries(riderFilterId);
  });
}
