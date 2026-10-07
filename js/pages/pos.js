/**
 * @file pages/pos.js
 * Controller for pos.html: Shift verification, dynamic product catalog, tier pricing,
 * in-memory shopping cart docket, customer search, and create_sale RPC transaction.
 */
import {
  resolveBranchId,
  getActiveShift,
  rpcOpenShift,
  rpcCloseShift,
  getProducts,
  getCustomers,
  rpcCreateSale
} from '../api.js';
import {
  formatPHP,
  escapeHTML,
  debounce,
  showToast,
  setButtonLoading,
  openModal,
  closeModal
} from '../ui.js';

let activeBranchId = null;
let currentShift = null;
let productsList = [];
let selectedCustomer = null;
let cart = []; // Array of { product: object, qty: number }
let activeCategory = 'all';

export async function init({ profile }) {
  activeBranchId = await resolveBranchId();

  // 1. Verify Active Shift
  await verifyShiftStatus();

  // 2. Load Products Catalog
  await loadProducts();

  // 3. Bind Customer Search
  setupCustomerSearch();

  // 4. Bind Payment & Cart Event Listeners
  setupCartActions();

  // 5. Shift Management Modal Bindings
  setupShiftModal();
}

/**
 * Checks if a shift is currently open; if not, alerts cashier and prompts open shift modal.
 */
async function verifyShiftStatus() {
  const shiftBadge = document.querySelector('[data-shift="status"]') || document.querySelector('.topbar-right .badge-success');
  const completeBtn = document.querySelector('[data-action="complete-sale"]') || document.querySelector('a[href="#complete-modal"]');

  if (!activeBranchId) return;

  const { data: shift, error } = await getActiveShift(activeBranchId);
  currentShift = shift;

  if (!currentShift) {
    if (shiftBadge) {
      shiftBadge.className = 'badge badge-danger';
      shiftBadge.innerHTML = '<span class="badge-dot"></span> Shift Closed — Open Shift Required';
    }
    showToast('Notice: You must open a shift with starting cash before processing sales.', 'warning', 5000);
    // Open shift modal automatically
    ensureOpenShiftModalExists();
    openModal('open-shift-modal');
  } else {
    if (shiftBadge) {
      shiftBadge.className = 'badge badge-success';
      shiftBadge.innerHTML = `<span class="badge-dot"></span> Shift Active (Opened: ${formatPHP(currentShift.opening_cash || 0)})`;
      shiftBadge.style.cursor = 'pointer';
      shiftBadge.title = 'Click to Close Shift';
      shiftBadge.addEventListener('click', () => {
        ensureCloseShiftModalExists();
        openModal('close-shift-modal');
      });
    }
  }
}

/**
 * Dynamically injects the Open Shift modal if not present in static HTML.
 */
function ensureOpenShiftModalExists() {
  if (document.getElementById('open-shift-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'open-shift-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3 class="modal-title">Open Shift Register</h3>
        <button type="button" class="modal-close-btn" data-action="close-shift-dialog">&times;</button>
      </div>
      <form id="open-shift-form">
        <div class="modal-body">
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px;">
            Enter the starting petty cash drawer balance to begin recording sales for this counter shift.
          </p>
          <div class="form-group">
            <label class="form-label" for="opening-cash-val">Starting Drawer Cash (₱) <span class="required">*</span></label>
            <div class="input-prefix-group">
              <span class="input-prefix">₱</span>
              <input type="number" id="opening-cash-val" class="form-control" value="1000" min="0" step="50" required autofocus>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="submit" class="btn btn-primary btn-block">Open Register & Begin Shift</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('[data-action="close-shift-dialog"]').addEventListener('click', closeModal);

  modal.querySelector('#open-shift-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cashVal = document.getElementById('opening-cash-val').value;
    const submitBtn = modal.querySelector('button[type="submit"]');

    setButtonLoading(submitBtn, true, 'Opening...');
    const { data: shiftId, error } = await rpcOpenShift(activeBranchId, cashVal);
    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Failed to open shift.', 'danger');
      return;
    }

    showToast('Shift successfully opened!', 'success');
    closeModal();
    window.location.reload();
  });
}

/**
 * Dynamically injects the Close Shift modal if not present.
 */
function ensureCloseShiftModalExists() {
  if (document.getElementById('close-shift-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'close-shift-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3 class="modal-title">Reconcile & Close Shift</h3>
        <button type="button" class="modal-close-btn" data-action="close-shift-dialog">&times;</button>
      </div>
      <form id="close-shift-form">
        <div class="modal-body">
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px;">
            Count the physical cash in the drawer to calculate variance against recorded transactions.
          </p>
          <div class="form-group">
            <label class="form-label" for="counted-cash-val">Counted Physical Cash (₱) <span class="required">*</span></label>
            <div class="input-prefix-group">
              <span class="input-prefix">₱</span>
              <input type="number" id="counted-cash-val" class="form-control" placeholder="0.00" min="0" required autofocus>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="cancel-close">Cancel</button>
          <button type="submit" class="btn btn-danger">Reconcile & End Shift</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-action="close-shift-dialog"], [data-action="cancel-close"]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });

  modal.querySelector('#close-shift-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentShift) return;

    const countedCash = document.getElementById('counted-cash-val').value;
    const submitBtn = modal.querySelector('button[type="submit"]');

    setButtonLoading(submitBtn, true, 'Closing Shift...');
    const { data: closedShift, error } = await rpcCloseShift(currentShift.id, countedCash);
    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Error closing shift.', 'danger');
      return;
    }

    const variance = closedShift?.variance || 0;
    const varText = variance >= 0 ? `+${formatPHP(variance)} (Overage)` : `${formatPHP(variance)} (Shortage)`;
    alert(`Shift closed successfully!\nCounted: ${formatPHP(countedCash)}\nVariance: ${varText}`);
    closeModal();
    window.location.reload();
  });
}

function setupShiftModal() {
  ensureOpenShiftModalExists();
}

/**
 * Loads products from API and renders the catalog grid.
 */
async function loadProducts() {
  const grid = document.querySelector('[data-grid="products"]') || document.querySelector('.pos-product-grid');
  if (!grid) return;

  grid.innerHTML = '<div style="padding: 24px; color: var(--text-muted);">Loading station products...</div>';

  const { data: products, error } = await getProducts(activeBranchId);
  if (error || !products || products.length === 0) {
    grid.innerHTML = '<div style="padding: 24px; color: var(--text-muted);">No products registered for this station branch.</div>';
    return;
  }

  productsList = products;
  renderProductGrid();
  setupCategoryFilters();
}

/**
 * Renders the products grid cards based on active category and customer pricing.
 */
function renderProductGrid() {
  const grid = document.querySelector('[data-grid="products"]') || document.querySelector('.pos-product-grid');
  if (!grid) return;

  const filtered = activeCategory === 'all'
    ? productsList
    : productsList.filter((p) => p.category === activeCategory);

  grid.innerHTML = filtered
    .map((product) => {
      const price = getProductPriceForCustomer(product);
      const inCartItem = cart.find((i) => i.product.id === product.id);
      const isSelected = Boolean(inCartItem);

      return `
        <div class="pos-product-card" data-product-id="${escapeHTML(product.id)}" style="${isSelected ? 'border-color: var(--primary);' : ''}">
          <div class="pos-product-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
            </svg>
          </div>
          <div class="pos-product-name">${escapeHTML(product.name)}</div>
          <div class="pos-product-meta">${escapeHTML(product.description || 'Station Item')}</div>
          <div class="pos-product-footer">
            <div class="pos-product-price">${formatPHP(price)}</div>
            ${
              isSelected
                ? `<span class="badge badge-success">In Cart (${inCartItem.qty})</span>`
                : `<span class="badge badge-primary">+ Add</span>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  // Attach card click handlers to add item to cart
  grid.querySelectorAll('.pos-product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const pId = card.dataset.productId;
      const product = productsList.find((p) => p.id === pId);
      if (product) {
        addToCart(product);
      }
    });
  });
}

/**
 * Resolves price for customer tier (walk_in, regular, reseller, commercial).
 * @param {object} product
 * @returns {number}
 */
function getProductPriceForCustomer(product) {
  const tier = selectedCustomer?.type || 'walk_in';
  const customPriceObj = (product.product_prices || []).find((pp) => pp.customer_type === tier);
  if (customPriceObj && customPriceObj.price !== null) {
    return Number(customPriceObj.price);
  }
  return Number(product.price) || 0;
}

/**
 * Binds category filtering pills.
 */
function setupCategoryFilters() {
  const catPills = document.querySelectorAll('.pos-cat-pill');
  catPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      catPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const text = pill.textContent.toLowerCase();
      if (text.includes('refill')) activeCategory = 'refill';
      else if (text.includes('container') || text.includes('bottle')) activeCategory = 'container';
      else if (text.includes('cap') || text.includes('seal')) activeCategory = 'seal';
      else if (text.includes('accessori')) activeCategory = 'accessory';
      else activeCategory = 'all';

      renderProductGrid();
    });
  });
}

/**
 * Binds customer selection and search input.
 */
function setupCustomerSearch() {
  const customerSelect = document.querySelector('select[name="customer"]') || document.querySelector('.pos-docket select');
  if (!customerSelect) return;

  // Populate known customers
  getCustomers({ pageSize: 50 }).then(({ data: customers }) => {
    if (!customers) return;
    customerSelect.innerHTML = `
      <option value="">Walk-in Customer (Cash Retail)</option>
      ${customers
        .map(
          (c) => `
        <option value="${escapeHTML(c.id)}" data-type="${escapeHTML(c.type || 'regular')}" data-balance="${c.balance || 0}" data-limit="${c.credit_limit || 1000}">
          ${escapeHTML(c.full_name)} (${c.type?.toUpperCase() || 'REGULAR'}) — Bal: ${formatPHP(c.balance || 0)}
        </option>
      `
        )
        .join('')}
    `;
  });

  customerSelect.addEventListener('change', (e) => {
    const custId = e.target.value;
    if (!custId) {
      selectedCustomer = null;
    } else {
      const opt = e.target.selectedOptions[0];
      selectedCustomer = {
        id: custId,
        full_name: opt.text.split('(')[0].trim(),
        type: opt.dataset.type,
        balance: Number(opt.dataset.balance) || 0,
        credit_limit: Number(opt.dataset.limit) || 1000
      };

      // Check if near credit limit
      if (selectedCustomer.balance >= selectedCustomer.credit_limit) {
        showToast(
          `Notice: ${selectedCustomer.full_name} has exceeded their credit limit of ${formatPHP(selectedCustomer.credit_limit)} (Current balance: ${formatPHP(selectedCustomer.balance)}).`,
          'warning',
          6000
        );
      }
    }

    // Re-render product grid and cart to reflect custom tier pricing
    renderProductGrid();
    renderCart();
  });
}

/**
 * Adds product to in-memory cart.
 * @param {object} product
 */
function addToCart(product) {
  const existing = cart.find((i) => i.product.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ product, qty: 1 });
  }
  renderProductGrid();
  renderCart();
}

/**
 * Decrements or removes an item.
 * @param {string} productId
 */
function decreaseItem(productId) {
  const idx = cart.findIndex((i) => i.product.id === productId);
  if (idx !== -1) {
    if (cart[idx].qty > 1) {
      cart[idx].qty -= 1;
    } else {
      cart.splice(idx, 1);
    }
  }
  renderProductGrid();
  renderCart();
}

/**
 * Increments an item.
 * @param {string} productId
 */
function increaseItem(productId) {
  const item = cart.find((i) => i.product.id === productId);
  if (item) {
    item.qty += 1;
  }
  renderProductGrid();
  renderCart();
}

/**
 * Renders the checkout order docket.
 */
function renderCart() {
  const cartContainer = document.querySelector('[data-cart="items"]') || document.querySelector('.pos-cart-items');
  const subtotalEl = document.querySelector('[data-cart="subtotal"]') || document.querySelector('.pos-total-row span:last-child');
  const grandTotalEl = document.querySelector('[data-cart="grand-total"]') || document.querySelector('.pos-total-row.grand span:last-child');
  const clearBtn = document.querySelector('.pos-docket-header a');
  const completeBtn = document.querySelector('[data-action="complete-sale"]') || document.querySelector('.pos-docket .btn-primary');

  if (!cartContainer) return;

  if (cart.length === 0) {
    cartContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Cart is empty. Select products from the catalog.</div>';
    if (subtotalEl) subtotalEl.textContent = '₱0.00';
    if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
    if (completeBtn) completeBtn.innerHTML = '<span>Complete Sale (₱0.00)</span>';
    return;
  }

  let totalAmount = 0;

  cartContainer.innerHTML = cart
    .map((item) => {
      const unitPrice = getProductPriceForCustomer(item.product);
      const rowTotal = unitPrice * item.qty;
      totalAmount += rowTotal;

      return `
        <div class="cart-item-row" data-id="${escapeHTML(item.product.id)}">
          <div class="cart-item-info">
            <div class="cart-item-title">${escapeHTML(item.product.name)}</div>
            <div class="cart-item-sub">${formatPHP(unitPrice)} / unit</div>
          </div>
          <div class="qty-control">
            <button type="button" class="qty-btn" data-action="minus" aria-label="Decrease quantity">-</button>
            <span class="qty-val">${item.qty}</span>
            <button type="button" class="qty-btn" data-action="plus" aria-label="Increase quantity">+</button>
          </div>
          <div class="cart-item-total">${formatPHP(rowTotal)}</div>
        </div>
      `;
    })
    .join('');

  // Check for Senior / PWD discount checkbox
  const discountCheckbox = document.querySelector('.pos-totals-box input[type="checkbox"]');
  if (discountCheckbox && discountCheckbox.checked) {
    totalAmount = Math.max(0, totalAmount * 0.8);
  }

  if (subtotalEl) subtotalEl.textContent = formatPHP(totalAmount);
  if (grandTotalEl) grandTotalEl.textContent = formatPHP(totalAmount);
  if (completeBtn) completeBtn.innerHTML = `<span>Complete Sale (${formatPHP(totalAmount)})</span>`;

  // Delegate quantity controls
  cartContainer.querySelectorAll('.cart-item-row').forEach((row) => {
    const pId = row.dataset.id;
    row.querySelector('[data-action="minus"]').addEventListener('click', () => decreaseItem(pId));
    row.querySelector('[data-action="plus"]').addEventListener('click', () => increaseItem(pId));
  });

  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.preventDefault();
      cart = [];
      renderProductGrid();
      renderCart();
    };
  }
}

/**
 * Handles sale submission, validation, RPC call, and receipt rendering.
 */
function setupCartActions() {
  const completeActionTrigger = document.querySelector('a[href="#complete-modal"]') || document.querySelector('.pos-docket .btn-primary');
  const discountCheckbox = document.querySelector('.pos-totals-box input[type="checkbox"]');

  if (discountCheckbox) {
    discountCheckbox.addEventListener('change', renderCart);
  }

  // Inject Gallons Lent / Returned Inputs into Cart docket if not yet in DOM
  injectContainerControls();

  if (completeActionTrigger) {
    completeActionTrigger.addEventListener('click', async (e) => {
      e.preventDefault();

      if (!currentShift) {
        showToast('Shift is closed. You must open a shift before completing sales.', 'danger');
        openModal('open-shift-modal');
        return;
      }

      if (cart.length === 0) {
        showToast('Cart is empty. Please add items to checkout.', 'warning');
        return;
      }

      // Read payment method
      const selectedPay = document.querySelector('input[name="pay_method"]:checked')?.value || 'cash';

      // Check credit rules: must have customer
      if (selectedPay === 'credit' && !selectedCustomer) {
        showToast('Credit (Utang) sales require selecting an assigned customer account.', 'danger');
        return;
      }

      // Calculate total
      let grandTotal = cart.reduce((sum, i) => sum + getProductPriceForCustomer(i.product) * i.qty, 0);
      if (discountCheckbox?.checked) grandTotal *= 0.8;

      const containersLent = Number(document.getElementById('pos-lent-qty')?.value) || 0;
      const containersBack = Number(document.getElementById('pos-back-qty')?.value) || 0;

      const saleItems = cart.map((i) => ({
        product_id: i.product.id,
        qty: i.qty
      }));

      const amountPaid = selectedPay === 'credit' ? 0 : grandTotal;

      setButtonLoading(completeActionTrigger, true, 'Processing Sale...');

      try {
        const { data: saleId, error } = await rpcCreateSale({
          branchId: activeBranchId,
          customerId: selectedCustomer?.id || null,
          saleType: 'walk_in',
          items: saleItems,
          paymentMethod: selectedPay,
          amountPaid,
          containersLent,
          containersBack
        });

        setButtonLoading(completeActionTrigger, false);

        if (error) {
          showToast(error.message || 'Transaction failed. Please check network connection.', 'danger');
          return;
        }

        // Render Slip Modal
        populateSlipReceiptModal(saleId, grandTotal, selectedPay, containersLent, containersBack);
        openModal('complete-modal');

        // Reset cart
        cart = [];
        renderProductGrid();
        renderCart();
      } catch (err) {
        setButtonLoading(completeActionTrigger, false);
        showToast('Offline or network timeout. Please retry.', 'danger');
      }
    });
  }
}

/**
 * Injects container loan/return input fields into the POS docket.
 */
function injectContainerControls() {
  const totalsBox = document.querySelector('.pos-totals-box');
  if (!totalsBox || document.getElementById('pos-containers-box')) return;

  const box = document.createElement('div');
  box.id = 'pos-containers-box';
  box.style.display = 'grid';
  box.style.gridTemplateColumns = '1fr 1fr';
  box.style.gap = '8px';
  box.style.margin = '8px 0';
  box.innerHTML = `
    <div>
      <label class="form-label" style="font-size: 0.72rem; margin: 0;">Gallons Lent</label>
      <input type="number" id="pos-lent-qty" class="form-control" style="padding: 4px 8px; font-size: 0.8rem;" value="0" min="0">
    </div>
    <div>
      <label class="form-label" style="font-size: 0.72rem; margin: 0;">Gallons Returned</label>
      <input type="number" id="pos-back-qty" class="form-control" style="padding: 4px 8px; font-size: 0.8rem;" value="0" min="0">
    </div>
  `;
  totalsBox.prepend(box);
}

/**
 * Fills details in the #complete-modal receipt for printing.
 */
function populateSlipReceiptModal(saleId, total, paymentMethod, lent, back) {
  const modal = document.getElementById('complete-modal');
  if (!modal) return;

  const slipShort = saleId ? `#SLP-${saleId.slice(0, 6).toUpperCase()}` : '#SLP-1049';
  const custName = selectedCustomer ? selectedCustomer.full_name : 'Walk-in Customer';

  const bodyEl = modal.querySelector('.modal-body');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="text-align: center; margin-bottom: var(--space-4);">
        <div style="font-size: 1.8rem; font-weight: 800; color: var(--primary);">${formatPHP(total)}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Payment: <strong>${paymentMethod.toUpperCase()}</strong></div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">${slipShort} • Customer: ${escapeHTML(custName)}</div>
      </div>

      <div class="printable-receipt" style="background-color: var(--bg-surface-alt); border-radius: var(--radius-md); padding: var(--space-4); font-family: monospace; font-size: 0.82rem;">
        <div style="text-align: center; font-weight: bold;">AQUAFLOW WATER REFILLING</div>
        <div style="text-align: center; font-size: 0.75rem; margin-bottom: 8px;">DOH Permit #0941 • Official Receipt Slip</div>
        <div style="border-top: 1px dashed var(--border-color); padding: 4px 0;">Slip ID: ${slipShort}</div>
        <div style="padding: 2px 0;">Customer: ${escapeHTML(custName)}</div>
        <div style="padding: 2px 0;">Containers Lent: ${lent} | Returned: ${back}</div>
        <div style="border-top: 1px dashed var(--border-color); margin-top: 4px; padding-top: 4px; font-weight: bold; display: flex; justify-content: space-between;">
          <span>TOTAL PAID:</span>
          <span>${formatPHP(total)}</span>
        </div>
      </div>
    `;
  }
}
