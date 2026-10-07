/**
 * @file pages/inventory.js
 * Controller for inventory.html: Stock levels, capacity progress bars, low-stock highlighting,
 * and stock_movements modal (Stock In / Stock Out).
 */
import {
  resolveBranchId,
  getInventory,
  getSuppliers,
  createStockMovement
} from '../api.js';
import {
  formatPHP,
  escapeHTML,
  showToast,
  setButtonLoading,
  openModal,
  closeModal,
  renderSkeleton
} from '../ui.js';

let activeBranchId = null;
let inventoryItems = [];

export async function init() {
  activeBranchId = await resolveBranchId();

  await loadInventoryTable();
  setupStockMovementModal();
}

/**
 * Loads inventory items and renders table with dynamic progress bars.
 */
async function loadInventoryTable() {
  const tbody = document.querySelector('.table tbody');
  if (!tbody) return;

  renderSkeleton(tbody, 5);

  const { data: items, error } = await getInventory(activeBranchId);
  if (error || !items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">No inventory items recorded.</td></tr>`;
    return;
  }

  inventoryItems = items;

  tbody.innerHTML = items
    .map((item) => {
      const current = Number(item.quantity) || 0;
      const reorder = Number(item.reorder_level) || 10;
      const capacity = Math.max(reorder * 3, current, 100);
      const pct = Math.min(Math.round((current / capacity) * 100), 100);

      let barColor = 'green';
      let statusBadge = '<span class="badge badge-success"><span class="badge-dot"></span> In Stock</span>';

      if (current <= reorder * 0.5) {
        barColor = 'red';
        statusBadge = '<span class="badge badge-danger"><span class="badge-dot"></span> Critical</span>';
      } else if (current <= reorder) {
        barColor = 'amber';
        statusBadge = '<span class="badge badge-warning"><span class="badge-dot"></span> Low Stock</span>';
      }

      const supplierName = item.suppliers?.name || 'Local Supplier';

      return `
        <tr data-id="${item.id}">
          <td><strong style="font-family: monospace;">#SKU-${item.sku || item.id.slice(0, 5).toUpperCase()}</strong></td>
          <td>
            <strong>${escapeHTML(item.name)}</strong>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHTML(item.description || item.unit || 'Standard Consumable')}</div>
          </td>
          <td><span class="badge badge-neutral">${escapeHTML(item.category || 'General')}</span></td>
          <td>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 3px;">
              <strong>${current} ${escapeHTML(item.unit || 'pcs')}</strong>
              <span style="font-weight: 700;">${pct}%</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill ${barColor}" style="width: ${pct}%;"></div>
            </div>
          </td>
          <td>${reorder} ${escapeHTML(item.unit || 'pcs')}</td>
          <td>${statusBadge}</td>
          <td>${escapeHTML(supplierName)}</td>
          <td>${formatPHP(item.cost_price || 0)}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Sets up the Stock Movement (In / Out) modal.
 */
function setupStockMovementModal() {
  const modal = document.getElementById('stock-modal');
  if (!modal) return;

  const form = modal.querySelector('form');
  const itemSelect = document.getElementById('adj-item');

  // Populate item options dynamically
  if (itemSelect && inventoryItems.length > 0) {
    itemSelect.innerHTML = inventoryItems
      .map((i) => `<option value="${i.id}">${escapeHTML(i.name)} (Current: ${i.quantity} ${i.unit || 'pcs'})</option>`)
      .join('');
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const itemId = itemSelect?.value;
      const movementType = document.getElementById('adj-type')?.value || 'in';
      const qty = Number(document.getElementById('adj-qty')?.value) || 0;
      const notes = document.getElementById('adj-notes')?.value.trim();
      const submitBtn = form.querySelector('button[type="submit"]');

      if (!itemId || qty <= 0) {
        showToast('Please enter a valid quantity.', 'warning');
        return;
      }

      setButtonLoading(submitBtn, true, 'Updating Stock...');

      const { data, error } = await createStockMovement({
        item_id: itemId,
        branch_id: activeBranchId,
        type: movementType,
        quantity: qty,
        notes: notes || null
      });

      setButtonLoading(submitBtn, false);

      if (error) {
        showToast(error.message || 'Stock adjustment failed.', 'danger');
        return;
      }

      showToast(`Stock ${movementType.toUpperCase()} of ${qty} units recorded!`, 'success');
      form.reset();
      closeModal();
      loadInventoryTable();
    });
  }
}
