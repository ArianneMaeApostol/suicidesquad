/**
 * @file pages/customers.js
 * Controller for customers.html: Server-paginated directory, debounced search,
 * category filtering, new customer registration modal, and record_payment RPC.
 */
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  rpcRecordPayment
} from '../api.js';
import {
  formatPHP,
  escapeHTML,
  debounce,
  showToast,
  setButtonLoading,
  openModal,
  closeModal,
  renderSkeleton,
  renderEmptyState
} from '../ui.js';

let currentPage = 1;
const pageSize = 10;
let currentSearch = '';
let currentType = 'all';
let totalRecords = 0;

export async function init() {
  setupSearchAndFilters();
  setupAddCustomerModal();
  setupRecordPaymentModal();
  await loadCustomerTable();
}

/**
 * Loads and renders customer records into the table.
 */
async function loadCustomerTable() {
  const tbody = document.querySelector('[data-table="customers"]') || document.querySelector('.table tbody');
  const countSpan = document.querySelector('.pagination span');
  if (!tbody) return;

  renderSkeleton(tbody, 5);

  const { data: customers, total, error } = await getCustomers({
    search: currentSearch,
    type: currentType,
    page: currentPage,
    pageSize
  });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load customers: ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  totalRecords = total;

  if (countSpan) {
    const start = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalRecords);
    countSpan.textContent = `Showing ${start} to ${end} of ${totalRecords} registered customers`;
  }

  if (customers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">No customers found matching "${escapeHTML(currentSearch)}".</td></tr>`;
    renderPaginationControls();
    return;
  }

  tbody.innerHTML = customers
    .map((cust) => {
      const typeBadges = {
        reseller: 'badge-warning',
        regular: 'badge-primary',
        commercial: 'badge-info',
        walk_in: 'badge-neutral'
      };
      const badgeCls = typeBadges[cust.type] || 'badge-neutral';
      const balanceColor = Number(cust.balance) > 0 ? 'var(--danger)' : 'var(--success)';

      return `
        <tr data-customer-id="${escapeHTML(cust.id)}">
          <td><strong style="color: var(--primary); font-family: monospace;">#CUST-${cust.id.slice(0, 5).toUpperCase()}</strong></td>
          <td>
            <a href="customer-profile.html?id=${cust.id}" style="font-weight: 700; color: var(--primary-dark); font-size: 0.95rem;">${escapeHTML(cust.full_name)}</a>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(cust.notes || cust.type?.toUpperCase() || 'Customer')}</div>
          </td>
          <td>
            <div>${escapeHTML(cust.phone || 'No phone')}</div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHTML(cust.address || 'Pasig City')}</div>
          </td>
          <td><span class="badge ${badgeCls}">${escapeHTML(cust.type || 'regular')}</span></td>
          <td>
            <strong>${cust.containers_out || 0} Lent</strong>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Balance Limit: ${formatPHP(cust.credit_limit || 1000)}</div>
          </td>
          <td><strong style="color: ${balanceColor};">${formatPHP(cust.balance || 0)}</strong></td>
          <td>${cust.last_order_at ? new Date(cust.last_order_at).toLocaleDateString('en-PH') : 'Recent'}</td>
          <td style="text-align: right; white-space: nowrap;">
            <a href="customer-profile.html?id=${cust.id}" class="btn btn-outline btn-sm">Profile</a>
            <button type="button" class="btn btn-secondary btn-sm" data-action="pay" data-id="${cust.id}" data-name="${escapeHTML(cust.full_name)}" data-balance="${cust.balance || 0}">Pay</button>
          </td>
        </tr>
      `;
    })
    .join('');

  // Attach quick pay buttons
  tbody.querySelectorAll('[data-action="pay"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { id, name, balance } = btn.dataset;
      openRecordPaymentDialog(id, name, balance);
    });
  });

  renderPaginationControls();
}

/**
 * Generates pagination page numbers and handlers.
 */
function renderPaginationControls() {
  const container = document.querySelector('.pagination-controls');
  if (!container) return;

  const totalPages = Math.ceil(totalRecords / pageSize) || 1;

  container.innerHTML = `
    <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo;</button>
    <button class="page-btn active">${currentPage}</button>
    <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">&raquo;</button>
  `;

  container.querySelectorAll('.page-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.page);
      if (target >= 1 && target <= totalPages) {
        currentPage = target;
        loadCustomerTable();
      }
    });
  });
}

/**
 * Sets up debounced search input and category filter buttons.
 */
function setupSearchAndFilters() {
  const searchInput = document.querySelector('.search-bar input') || document.querySelector('input[type="search"]');
  if (searchInput) {
    searchInput.addEventListener(
      'input',
      debounce((e) => {
        currentSearch = e.target.value;
        currentPage = 1;
        loadCustomerTable();
      }, 350)
    );
  }

  const pills = document.querySelectorAll('.pos-cat-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      pills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');

      const text = pill.textContent.toLowerCase();
      if (text.includes('reseller')) currentType = 'reseller';
      else if (text.includes('regular')) currentType = 'regular';
      else if (text.includes('commercial')) currentType = 'commercial';
      else if (text.includes('balance')) currentType = 'all'; // handled via search or filter
      else currentType = 'all';

      currentPage = 1;
      loadCustomerTable();
    });
  });
}

/**
 * Handles new customer registration form submission.
 */
function setupAddCustomerModal() {
  const modal = document.getElementById('add-customer-modal');
  if (!modal) return;

  const form = modal.querySelector('form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = document.getElementById('cust-name')?.value.trim();
    const phone = document.getElementById('cust-contact')?.value.trim();
    const type = document.getElementById('cust-type')?.value || 'regular';
    const barangay = document.getElementById('cust-brgy')?.value || '';
    const address = document.getElementById('cust-address')?.value.trim();
    const containersOut = Number(document.getElementById('cust-containers')?.value) || 0;
    const creditLimit = Number(document.getElementById('cust-credit-limit')?.value) || 1000;
    const submitBtn = form.querySelector('button[type="submit"]');

    if (!fullName) {
      showToast('Please provide customer name.', 'danger');
      return;
    }

    setButtonLoading(submitBtn, true, 'Registering...');

    const { data, error } = await createCustomer({
      full_name: fullName,
      phone,
      type,
      barangay,
      address,
      containers_out: containersOut,
      credit_limit: creditLimit,
      balance: 0
    });

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Error creating customer.', 'danger');
      return;
    }

    showToast(`Customer ${fullName} registered successfully!`, 'success');
    form.reset();
    closeModal();
    loadCustomerTable();
  });
}

/**
 * Injects and manages the Record Payment dialog.
 */
function setupRecordPaymentModal() {
  if (document.getElementById('quick-payment-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'quick-payment-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3 class="modal-title">Record Account Payment</h3>
        <button type="button" class="modal-close-btn" data-action="close-pay">&times;</button>
      </div>
      <form id="quick-payment-form">
        <input type="hidden" id="pay-customer-id">
        <div class="modal-body">
          <div style="margin-bottom: 16px;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">Customer:</span>
            <div id="pay-customer-name" style="font-size: 1.1rem; font-weight: 700;"></div>
            <div id="pay-customer-balance" style="font-size: 0.85rem; color: var(--danger); font-weight: 600;"></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pay-amount-input">Payment Amount (₱) <span class="required">*</span></label>
            <div class="input-prefix-group">
              <span class="input-prefix">₱</span>
              <input type="number" id="pay-amount-input" class="form-control" min="1" step="0.5" required autofocus>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="pay-method-select">Payment Method</label>
            <select id="pay-method-select" class="form-control">
              <option value="cash">Cash on Hand</option>
              <option value="gcash">GCash E-Wallet</option>
              <option value="maya">Maya E-Wallet</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="pay-ref-input">Reference # / Notes</label>
            <input type="text" id="pay-ref-input" class="form-control" placeholder="e.g. GCash Ref #918237">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="close-pay">Cancel</button>
          <button type="submit" class="btn btn-success">Record Payment</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-action="close-pay"]').forEach((b) => b.addEventListener('click', closeModal));

  modal.querySelector('#quick-payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const custId = document.getElementById('pay-customer-id').value;
    const amount = document.getElementById('pay-amount-input').value;
    const method = document.getElementById('pay-method-select').value;
    const ref = document.getElementById('pay-ref-input').value;
    const submitBtn = modal.querySelector('button[type="submit"]');

    setButtonLoading(submitBtn, true, 'Recording...');

    const { data, error } = await rpcRecordPayment({
      customerId: custId,
      amount,
      method,
      reference: ref
    });

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Payment recording failed.', 'danger');
      return;
    }

    showToast('Payment recorded successfully! Balance updated.', 'success');
    closeModal();
    loadCustomerTable();
  });
}

function openRecordPaymentDialog(customerId, customerName, balance) {
  document.getElementById('pay-customer-id').value = customerId;
  document.getElementById('pay-customer-name').textContent = customerName;
  document.getElementById('pay-customer-balance').textContent = `Current Balance: ${formatPHP(balance)}`;
  document.getElementById('pay-amount-input').value = Math.max(Number(balance) || 0, 0);
  openModal('quick-payment-modal');
}
