/**
 * @file pages/deliveries.js
 * Controller for deliveries.html: Kanban dispatch board, live updates,
 * rider assignment, mobile-friendly rider action buttons, and status transitions.
 */
import {
  resolveBranchId,
  getDeliveries,
  getRiders,
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
let deliveriesList = [];

export async function init({ profile }) {
  currentProfile = profile;
  activeBranchId = await resolveBranchId();

  // If rider, only view deliveries assigned to self
  const riderFilterId = profile.role === 'rider' ? profile.id : null;

  // Load riders for assignment dropdowns (if manager/owner)
  if (profile.role !== 'rider') {
    const { data: riders } = await getRiders(activeBranchId);
    ridersList = riders || [];
  }

  // Load Initial Deliveries
  await fetchAndRenderDeliveries(riderFilterId);

  // Setup Realtime Live Channel
  realtimeChannel = subscribeDeliveries(activeBranchId, (payload) => {
    fetchAndRenderDeliveries(riderFilterId);
  });

  // Clean up realtime channel on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) {
      realtimeChannel.unsubscribe();
    }
  });

  setupNewTripModal();
}

/**
 * Fetches deliveries and distributes them into the 4 Kanban columns.
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
  renderKanbanColumns();
}

/**
 * Renders the Kanban columns: Pending, Assigned, Out for Delivery, Delivered.
 */
function renderKanbanColumns() {
  const colPending = document.querySelectorAll('.kanban-col .kanban-cards')[0];
  const colAssigned = document.querySelectorAll('.kanban-col .kanban-cards')[1];
  const colOut = document.querySelectorAll('.kanban-col .kanban-cards')[2];
  const colDelivered = document.querySelectorAll('.kanban-col .kanban-cards')[3];

  if (!colPending || !colAssigned || !colOut || !colDelivered) return;

  const grouped = {
    pending: deliveriesList.filter((d) => d.status === 'pending'),
    assigned: deliveriesList.filter((d) => d.status === 'assigned'),
    out_for_delivery: deliveriesList.filter((d) => d.status === 'out_for_delivery'),
    delivered: deliveriesList.filter((d) => d.status === 'delivered')
  };

  // Update column counter badges
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
 * @param {Array<object>} list
 * @param {string} status
 * @returns {string}
 */
function renderCards(list, status) {
  if (list.length === 0) {
    return `<div style="text-align: center; color: var(--text-muted); font-size: 0.78rem; padding: 24px 8px;">No ${status} orders</div>`;
  }

  const isRider = currentProfile?.role === 'rider';

  return list
    .map((d) => {
      const orderCode = `#DEL-${d.id.slice(0, 5).toUpperCase()}`;
      const customerName = d.customers ? d.customers.full_name : 'Customer';
      const address = d.customers ? `${d.customers.address || ''}, ${d.customers.barangay || ''}` : 'Pasig';
      const riderName = d.rider?.full_name || 'Unassigned';

      // Action buttons depending on state and role
      let actionButtons = '';

      if (status === 'pending' && !isRider) {
        actionButtons = `
          <div style="margin-top: 8px;">
            <select class="form-control select-rider-dropdown" data-id="${d.id}" style="font-size: 0.78rem; padding: 4px;">
              <option value="">Assign Rider...</option>
              ${ridersList.map((r) => `<option value="${r.id}">${escapeHTML(r.full_name)}</option>`).join('')}
            </select>
          </div>
        `;
      } else if (status === 'assigned') {
        actionButtons = `
          <div style="margin-top: 8px; display: flex; gap: 4px;">
            <button type="button" class="btn btn-primary btn-sm btn-block" data-action="set-status" data-id="${d.id}" data-status="out_for_delivery">
              Dispatch (Out) &rarr;
            </button>
          </div>
        `;
      } else if (status === 'out_for_delivery') {
        actionButtons = `
          <div style="margin-top: 8px; display: flex; gap: 4px;">
            <button type="button" class="btn btn-success btn-sm btn-block" data-action="set-status" data-id="${d.id}" data-status="delivered" style="font-size: 0.85rem; padding: 8px;">
              &#10003; Delivered & Remit
            </button>
          </div>
        `;
      }

      return `
        <div class="kanban-card" data-id="${d.id}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="delivery-id-tag">${escapeHTML(orderCode)}</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">${formatDate(d.created_at, true)}</span>
          </div>
          <div class="delivery-customer">${escapeHTML(customerName)}</div>
          <div class="delivery-address">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHTML(address)}</span>
          </div>
          <div style="font-size: 0.8rem; margin-bottom: 6px;">
            <strong>${d.containers_count || 5}x</strong> Slim Gallons Refill
          </div>
          ${
            d.rider_id
              ? `<div style="background-color: var(--bg-surface-alt); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.74rem; margin-bottom: 6px;">
                  Rider: <strong>${escapeHTML(riderName)}</strong>
                </div>`
              : ''
          }
          <div class="delivery-footer">
            <span class="badge ${d.is_paid ? 'badge-success' : 'badge-warning'}">${d.is_paid ? 'Paid' : 'COD Cash'}</span>
            <strong style="color: var(--primary);">${formatPHP(d.total_amount || 0)}</strong>
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
  // Rider selection
  document.querySelectorAll('.select-rider-dropdown').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const riderId = e.target.value;
      const deliveryId = sel.dataset.id;
      if (!riderId) return;

      const { error } = await assignDeliveryRider(deliveryId, riderId);
      if (error) {
        showToast(error.message || 'Failed to assign rider.', 'danger');
      } else {
        showToast('Rider assigned!', 'success');
      }
    });
  });

  // Status transitions
  document.querySelectorAll('[data-action="set-status"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { id, status } = btn.dataset;
      setButtonLoading(btn, true);

      const { error } = await rpcSetDeliveryStatus(id, status);
      setButtonLoading(btn, false);

      if (error) {
        showToast(error.message || 'Status update failed.', 'danger');
      } else {
        showToast(`Delivery status moved to ${status}!`, 'success');
      }
    });
  });
}

function setupNewTripModal() {
  const modal = document.getElementById('new-delivery-modal');
  if (!modal) return;
  const form = modal.querySelector('form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('New delivery trip booked!', 'success');
    closeModal();
  });
}
