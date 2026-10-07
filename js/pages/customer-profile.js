/**
 * @file pages/customer-profile.js
 * Controller for customer-profile.html: Customer 360 view, transaction history,
 * container ledger, payment records, and return gallons action.
 */
import {
  getCustomerById,
  getRecentSales,
  getCustomerContainerLedger,
  getCustomerPayments,
  rpcRecordPayment,
  updateCustomer
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

let customerId = null;
let currentCustomer = null;

export async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  customerId = urlParams.get('id');

  if (!customerId) {
    // If no ID passed, return to customers directory
    window.location.href = 'customers.html';
    return;
  }

  await loadCustomerProfile();
  await Promise.all([
    loadTransactions(),
    loadContainerLedger(),
    loadBalanceSOA()
  ]);

  setupProfileActions();
}

/**
 * Loads the customer record and renders header details.
 */
async function loadCustomerProfile() {
  const { data: customer, error } = await getCustomerById(customerId);
  if (error || !customer) {
    showToast('Customer record not found.', 'danger');
    setTimeout(() => (window.location.href = 'customers.html'), 1500);
    return;
  }

  currentCustomer = customer;

  // Header Elements
  const titleEl = document.querySelector('.card-body h1') || document.querySelector('.page-title');
  if (titleEl) titleEl.textContent = customer.full_name;

  const phoneSpan = document.querySelector('.card-body span:first-of-type strong');
  if (phoneSpan) phoneSpan.textContent = `${customer.full_name} (${customer.phone || 'No phone'})`;

  const addrSpan = document.querySelectorAll('.card-body span')[1]?.querySelector('strong');
  if (addrSpan) addrSpan.textContent = customer.address || 'Pasig City';

  const memberSinceSpan = document.querySelectorAll('.card-body span')[2]?.querySelector('strong');
  if (memberSinceSpan) memberSinceSpan.textContent = formatDate(customer.created_at, false);

  // Lifetime Refills
  const refillMetrics = document.querySelectorAll('.card-body strong');
  if (refillMetrics[3]) refillMetrics[3].textContent = `${customer.total_refills || 0} gals`;
  // Borrowed Containers
  if (refillMetrics[4]) refillMetrics[4].textContent = `${customer.containers_out || 0} units`;
  // Balance
  if (refillMetrics[5]) {
    refillMetrics[5].textContent = formatPHP(customer.balance || 0);
    refillMetrics[5].style.color = Number(customer.balance) > 0 ? 'var(--danger)' : 'var(--success)';
  }
  // Credit Limit
  if (refillMetrics[6]) refillMetrics[6].textContent = formatPHP(customer.credit_limit || 1000);

  // Pre-fill payment modal amount if exists
  const payAmtInput = document.getElementById('pay-amt');
  if (payAmtInput) {
    payAmtInput.value = Math.max(Number(customer.balance) || 0, 0);
  }
}

/**
 * Loads recent sales transactions made by this customer.
 */
async function loadTransactions() {
  const txTable = document.querySelector('#content-tx table tbody');
  if (!txTable) return;

  const { data: sales, error } = await getRecentSales({ customerId, limit: 15 });
  if (error || !sales || sales.length === 0) {
    txTable.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No transactions recorded for this customer yet.</td></tr>`;
    return;
  }

  txTable.innerHTML = sales
    .map((s) => {
      const items = (s.sale_items || []).map((i) => `${i.qty}x ${i.products?.name || 'Refill'}`).join(', ');
      return `
        <tr>
          <td><strong style="color: var(--primary); font-family: monospace;">#SLP-${s.id.slice(0, 6).toUpperCase()}</strong></td>
          <td>${formatDate(s.created_at)}</td>
          <td>${escapeHTML(items || 'Water Refill')}</td>
          <td><strong>${formatPHP(s.total_amount || 0)}</strong></td>
          <td><span class="badge badge-neutral">${escapeHTML((s.payment_method || 'cash').toUpperCase())}</span></td>
          <td><span class="badge badge-success">Completed</span></td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Loads container borrowing ledger.
 */
async function loadContainerLedger() {
  const contTable = document.querySelector('#content-containers table tbody');
  if (!contTable) return;

  const { data: ledger, error } = await getCustomerContainerLedger(customerId);
  if (error || !ledger || ledger.length === 0) {
    contTable.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No borrowed container history found.</td></tr>`;
    return;
  }

  contTable.innerHTML = ledger
    .map((c) => {
      const isReturned = c.returned_at !== null;
      const badgeCls = isReturned ? 'badge-success' : 'badge-warning';
      const statusText = isReturned ? 'Returned' : 'With Customer';

      return `
        <tr>
          <td><strong style="color: var(--primary); font-family: monospace;">#CONT-${c.id.slice(0, 6).toUpperCase()}</strong></td>
          <td>${escapeHTML(c.container_type || '5-Gal Slim Tap')}</td>
          <td>${formatDate(c.created_at, false)}</td>
          <td><span class="badge ${badgeCls}">${statusText}</span></td>
          <td>${c.returned_at ? formatDate(c.returned_at, false) : 'Active Loan'}</td>
          <td>${escapeHTML(c.notes || 'Station Account')}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Loads statement of account (debits from sales, credits from payments).
 */
async function loadBalanceSOA() {
  const soaTable = document.querySelector('#content-balance table tbody');
  if (!soaTable) return;

  const [salesRes, paymentsRes] = await Promise.all([
    getRecentSales({ customerId, limit: 10 }),
    getCustomerPayments(customerId)
  ]);

  const sales = salesRes.data || [];
  const payments = paymentsRes.data || [];

  // Combine and sort chronologically
  const entries = [
    ...sales.map((s) => ({
      date: s.created_at,
      desc: `Refill Order (Slip #${s.id.slice(0, 6).toUpperCase()})`,
      debit: s.payment_method === 'credit' ? Number(s.total_amount) : 0,
      credit: 0
    })),
    ...payments.map((p) => ({
      date: p.created_at,
      desc: `Payment Received (${p.method?.toUpperCase()} ${p.reference ? '- ' + p.reference : ''})`,
      debit: 0,
      credit: Number(p.amount)
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (entries.length === 0) {
    soaTable.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No financial activity recorded.</td></tr>`;
    return;
  }

  let running = currentCustomer?.balance || 0;

  soaTable.innerHTML = entries
    .map((e) => {
      const debitText = e.debit > 0 ? `+${formatPHP(e.debit)}` : '—';
      const creditText = e.credit > 0 ? `-${formatPHP(e.credit)}` : '—';

      return `
        <tr>
          <td>${formatDate(e.date, false)}</td>
          <td>${escapeHTML(e.desc)}</td>
          <td style="color: var(--danger); font-weight: 600;">${debitText}</td>
          <td style="color: var(--success); font-weight: 600;">${creditText}</td>
          <td><strong>${formatPHP(running)}</strong></td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Configures payment submission and gallon return actions.
 */
function setupProfileActions() {
  // Bind Payment Modal Form
  const paymentModal = document.getElementById('payment-modal');
  if (paymentModal) {
    const form = paymentModal.querySelector('form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amt = document.getElementById('pay-amt')?.value;
        const method = document.getElementById('pay-type')?.value || 'cash';
        const ref = document.getElementById('pay-ref')?.value || '';
        const submitBtn = form.querySelector('button[type="submit"]');

        setButtonLoading(submitBtn, true, 'Recording Payment...');

        const { data, error } = await rpcRecordPayment({
          customerId,
          amount: amt,
          method,
          reference: ref
        });

        setButtonLoading(submitBtn, false);

        if (error) {
          showToast(error.message || 'Payment failed.', 'danger');
          return;
        }

        showToast('Payment credited successfully!', 'success');
        closeModal();
        window.location.reload();
      });
    }
  }

  // Bind Gallons Return Action
  const returnBtn = document.querySelector('a[href="#container-modal"]');
  if (returnBtn) {
    returnBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const countStr = prompt('How many containers are being returned right now?', '1');
      if (!countStr) return;
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count <= 0) return;

      const newOut = Math.max(0, (currentCustomer.containers_out || 0) - count);
      const { error } = await updateCustomer(customerId, { containers_out: newOut });
      if (error) {
        showToast('Error updating container ledger.', 'danger');
      } else {
        showToast(`${count} containers marked as returned!`, 'success');
        window.location.reload();
      }
    });
  }
}
