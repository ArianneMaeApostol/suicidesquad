/**
 * @file pages/pos.js
 * Controller for pos.html: Shift verification, dynamic product catalog, tier pricing,
 * real-time search, category filters, shopping cart docket, customer assignment,
 * container tracking, custom item modal, held orders, and create_sale RPC transaction.
 */
import {
  resolveBranchId,
  getActiveShift,
  rpcOpenShift,
  rpcCloseShift,
  getProducts,
  getCustomers,
  rpcCreateSale,
  getRecentSales,
  rpcVoidSale
} from '../api.js';
import {
  formatPHP,
  formatDate,
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
let searchQuery = '';
let currentCashierProfile = null;

export async function init({ profile }) {
  currentCashierProfile = profile;
  activeBranchId = await resolveBranchId();

  // 1. Verify Active Shift
  await verifyShiftStatus();

  // 2. Load Products Catalog
  await loadProducts();

  // 3. Bind Real-Time Product Search
  setupProductSearch();

  // 4. Bind Customer Search & Tier Pricing
  setupCustomerSearch();

  // 5. Bind Cart Actions & Checkout Listener
  setupCartActions();

  // 6. Custom Item Modal
  setupCustomItemModal();

  // 7. Hold / Resume Order Feature
  setupHoldOrder();

  // 8. Shift Management Modal Bindings
  setupShiftModal();

  // 9. Cash Tender & Change Due Calculator
  setupCashTender();

  // 10. Recent Transactions & Void Modal
  setupRecentSalesModal();

  // 11. Initial Render of Cart Docket
  renderCart();
}


/**
 * Checks if a shift is currently open; if not, alerts cashier and prompts open shift modal.
 */
async function verifyShiftStatus() {
  const shiftBadge = document.querySelector('[data-shift="status"]') || document.querySelector('.topbar-right .badge-success');

  if (!activeBranchId) return;

  const { data: shift, error } = await getActiveShift(activeBranchId);
  currentShift = shift;

  if (!currentShift) {
    if (shiftBadge) {
      shiftBadge.className = 'badge badge-danger';
      shiftBadge.innerHTML = '<span class="badge-dot"></span> Shift Closed — Open Shift Required';
      shiftBadge.style.cursor = 'pointer';
      shiftBadge.title = 'Click to Open Shift Register';
      shiftBadge.onclick = () => {
        ensureOpenShiftModalExists();
        openModal('open-shift-modal');
      };
    }
    showToast('Notice: You must open a shift with starting cash before processing sales.', 'warning', 5000);
    ensureOpenShiftModalExists();
    openModal('open-shift-modal');
  } else {
    if (shiftBadge) {
      shiftBadge.className = 'badge badge-success';
      shiftBadge.innerHTML = `<span class="badge-dot"></span> Shift Active (Opened: ${formatPHP(currentShift.opening_cash || 0)})`;
      shiftBadge.style.cursor = 'pointer';
      shiftBadge.title = 'Click to Reconcile & Close Shift';
      shiftBadge.onclick = () => {
        ensureCloseShiftModalExists();
        openModal('close-shift-modal');
      };
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
            Enter the starting petty cash drawer float balance to begin recording counter transactions.
          </p>
          <div class="form-group">
            <label class="form-label" for="opening-cash-val">Starting Drawer Float (₱) <span class="required">*</span></label>
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

    setButtonLoading(submitBtn, true, 'Opening Register...');
    const { data: shiftId, error } = await rpcOpenShift(activeBranchId, cashVal);
    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Failed to open shift.', 'danger');
      return;
    }

    showToast('Register opened successfully!', 'success');
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
              <input type="number" id="counted-cash-val" class="form-control" placeholder="0.00" min="0" step="1" required autofocus>
            </div>
          </div>
          <div class="form-group" style="margin-top: 12px;">
            <label class="form-label" for="shift-notes">Shift Handover Notes (Optional)</label>
            <textarea id="shift-notes" class="form-control" rows="2" placeholder="e.g. Minor coins shortage, handover to Shift B"></textarea>
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
    const notes = document.getElementById('shift-notes')?.value.trim() || null;
    const submitBtn = modal.querySelector('button[type="submit"]');

    setButtonLoading(submitBtn, true, 'Reconciling Shift...');
    const { data: closedShift, error } = await rpcCloseShift(currentShift.id, countedCash, notes);
    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Error closing shift.', 'danger');
      return;
    }

    const variance = Number(closedShift?.variance) || 0;
    const varText = variance >= 0 ? `+${formatPHP(variance)} (Overage)` : `${formatPHP(variance)} (Shortage)`;
    alert(`Shift successfully reconciled & closed!\n\nCounted Cash: ${formatPHP(countedCash)}\nVariance: ${varText}`);
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

  grid.innerHTML = '<div style="padding: 24px; color: var(--text-muted); grid-column: 1 / -1; text-align: center;">Loading station products...</div>';

  const { data: products, error } = await getProducts(activeBranchId);
  if (error || !products || products.length === 0) {
    grid.innerHTML = '<div style="padding: 24px; color: var(--text-muted); grid-column: 1 / -1; text-align: center;">No products registered for this station branch.</div>';
    return;
  }

  productsList = products;
  renderProductGrid();
  setupCategoryFilters();
}

/**
 * Renders the products grid cards based on active category, search query, and customer pricing.
 */
function renderProductGrid() {
  const grid = document.querySelector('[data-grid="products"]') || document.querySelector('.pos-product-grid');
  if (!grid) return;

  const filtered = productsList.filter((product) => {
    const matchesCategory = activeCategory === 'all' || product.category === activeCategory;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      (product.name && product.name.toLowerCase().includes(query)) ||
      (product.description && product.description.toLowerCase().includes(query)) ||
      (product.category && product.category.toLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
        No products match "${escapeHTML(searchQuery || activeCategory)}".<br>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top: 10px;" id="btn-clear-filter">Show All Items</button>
      </div>
    `;
    const clearFilterBtn = document.getElementById('btn-clear-filter');
    if (clearFilterBtn) {
      clearFilterBtn.onclick = () => {
        searchQuery = '';
        activeCategory = 'all';
        const searchInput = document.querySelector('.pos-catalog input[type="search"]');
        if (searchInput) searchInput.value = '';
        document.querySelectorAll('.pos-cat-pill').forEach((p, idx) => {
          p.classList.toggle('active', idx === 0);
        });
        renderProductGrid();
      };
    }
    return;
  }

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
  return Number(product.price) || 30.0;
}

/**
 * Binds product search input with debounce.
 */
function setupProductSearch() {
  const searchInput = document.querySelector('.pos-catalog input[type="search"]');
  if (!searchInput) return;

  searchInput.addEventListener(
    'input',
    debounce((e) => {
      searchQuery = (e.target.value || '').trim();
      renderProductGrid();
    }, 150)
  );
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
  const customerSelect = document.querySelector('select[name="customer"]') || document.getElementById('pos-customer-select') || document.querySelector('.pos-docket select');
  if (!customerSelect) return;

  getCustomers({ pageSize: 50 }).then(({ data: customers }) => {
    if (!customers) return;
    customerSelect.innerHTML = `
      <option value="">Walk-in Customer (Cash Retail)</option>
      ${customers
        .map(
          (c) => `
        <option value="${escapeHTML(c.id)}" data-type="${escapeHTML(c.type || 'regular')}" data-balance="${c.balance || 0}" data-limit="${c.credit_limit || 1000}">
          ${escapeHTML(c.full_name)} (${(c.type || 'regular').toUpperCase()}) — Bal: ${formatPHP(c.balance || 0)}
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
        type: opt.dataset.type || 'regular',
        balance: Number(opt.dataset.balance) || 0,
        credit_limit: Number(opt.dataset.limit) || 1000
      };

      if (selectedCustomer.balance >= selectedCustomer.credit_limit) {
        showToast(
          `Notice: ${selectedCustomer.full_name} has reached credit limit of ${formatPHP(selectedCustomer.credit_limit)} (Current balance: ${formatPHP(selectedCustomer.balance)}).`,
          'warning',
          6000
        );
      }
    }

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
  const countEl = document.querySelector('[data-cart="item-count"]');
  const subtotalEl = document.querySelector('[data-cart="subtotal"]') || document.querySelector('.pos-total-row span:last-child');
  const grandTotalEl = document.querySelector('[data-cart="grand-total"]') || document.querySelector('.pos-total-row.grand span:last-child');
  const clearBtn = document.querySelector('[data-action="clear-cart"]') || document.querySelector('.pos-docket-header a');
  const completeBtn = document.querySelector('[data-action="complete-sale"]') || document.querySelector('.pos-docket .btn-primary');
  const discountCheckbox = document.getElementById('pos-discount-check') || document.querySelector('.pos-totals-box input[type="checkbox"]');

  if (!cartContainer) return;

  if (cart.length === 0) {
    cartContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Cart is empty. Select products from the catalog.</div>';
    if (countEl) countEl.textContent = 'Subtotal (0 items)';
    if (subtotalEl) subtotalEl.textContent = '₱0.00';
    if (grandTotalEl) grandTotalEl.textContent = '₱0.00';
    if (completeBtn) completeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Complete Sale (₱0.00)</span>';
    updateCashChangeCalculation(0);
    return;
  }

  let totalItemsCount = 0;
  let rawSubtotal = 0;

  cartContainer.innerHTML = cart
    .map((item) => {
      const unitPrice = getProductPriceForCustomer(item.product);
      const rowTotal = unitPrice * item.qty;
      totalItemsCount += item.qty;
      rawSubtotal += rowTotal;

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

  let grandTotal = rawSubtotal;
  if (discountCheckbox && discountCheckbox.checked) {
    grandTotal = Math.max(0, rawSubtotal * 0.8);
  }

  if (countEl) countEl.textContent = `Subtotal (${totalItemsCount} ${totalItemsCount === 1 ? 'item' : 'items'})`;
  if (subtotalEl) subtotalEl.textContent = formatPHP(rawSubtotal);
  if (grandTotalEl) grandTotalEl.textContent = formatPHP(grandTotal);
  if (completeBtn) completeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Complete Sale (${formatPHP(grandTotal)})</span>`;

  // Update dynamic tender calculation based on new grandTotal
  updateCashChangeCalculation(grandTotal);

  // Quantity controls
  cartContainer.querySelectorAll('.cart-item-row').forEach((row) => {
    const pId = row.dataset.id;
    row.querySelector('[data-action="minus"]').addEventListener('click', () => decreaseItem(pId));
    row.querySelector('[data-action="plus"]').addEventListener('click', () => increaseItem(pId));
  });

  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.preventDefault();
      cart = [];
      const tenderInput = document.getElementById('pos-tender-input');
      if (tenderInput) tenderInput.value = '';
      document.querySelectorAll('.btn-preset-chip').forEach(c => c.classList.remove('active'));
      renderProductGrid();
      renderCart();
      updateCashChangeCalculation(0);
    };
  }
}

/**
 * Handles sale submission, validation, RPC call, and receipt rendering.
 */
function setupCartActions() {
  const completeActionTrigger = document.querySelector('[data-action="complete-sale"]') || document.querySelector('a[href="#complete-modal"]');
  const discountCheckbox = document.getElementById('pos-discount-check') || document.querySelector('.pos-totals-box input[type="checkbox"]');

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
        ensureOpenShiftModalExists();
        openModal('open-shift-modal');
        return;
      }

      if (cart.length === 0) {
        showToast('Cart is empty. Please select products to complete a sale.', 'warning');
        return;
      }

      const selectedPay = document.querySelector('input[name="pay_method"]:checked')?.value || 'cash';

      if (selectedPay === 'credit' && !selectedCustomer) {
        showToast('Credit (Utang) sales require selecting an assigned customer account.', 'danger');
        const customerSelect = document.getElementById('pos-customer-select') || document.querySelector('select[name="customer"]');
        if (customerSelect) {
          customerSelect.focus();
          customerSelect.style.borderColor = 'var(--danger)';
          setTimeout(() => (customerSelect.style.borderColor = ''), 2500);
        }
        return;
      }

      const rawSubtotal = cart.reduce((sum, i) => sum + getProductPriceForCustomer(i.product) * i.qty, 0);
      let grandTotal = rawSubtotal;
      let discountAmount = 0.0;
      if (discountCheckbox?.checked) {
        discountAmount = rawSubtotal * 0.2;
        grandTotal = Math.max(0, rawSubtotal - discountAmount);
      }

      let amountPaid = 0;
      let changeAmount = 0;

      if (selectedPay === 'cash') {
        const tenderInput = document.getElementById('pos-tender-input');
        const tenderStr = tenderInput?.value.trim() || '';
        const tenderedVal = tenderStr ? parseFloat(tenderStr) : grandTotal;
        if (isNaN(tenderedVal) || tenderedVal < grandTotal) {
          showToast(`Tendered cash (${formatPHP(tenderedVal || 0)}) is less than total due (${formatPHP(grandTotal)}).`, 'warning');
          if (tenderInput) {
            tenderInput.focus();
            tenderInput.style.borderColor = 'var(--danger)';
            setTimeout(() => (tenderInput.style.borderColor = ''), 2500);
          }
          return;
        }
        amountPaid = tenderedVal;
        changeAmount = Math.max(0, amountPaid - grandTotal);
      } else if (selectedPay === 'credit') {
        amountPaid = 0;
        changeAmount = 0;
      } else {
        // GCash or Maya digital wallet
        amountPaid = grandTotal;
        changeAmount = 0;
      }

      const containersLent = Number(document.getElementById('pos-lent-qty')?.value) || 0;
      const containersBack = Number(document.getElementById('pos-back-qty')?.value) || 0;

      const saleItems = cart.map((i) => ({
        product_id: i.product.id,
        qty: i.qty,
        unit_price: getProductPriceForCustomer(i.product),
        subtotal: getProductPriceForCustomer(i.product) * i.qty
      }));

      setButtonLoading(completeActionTrigger, true, 'Processing Sale...');

      try {
        const { data: saleId, error } = await rpcCreateSale({
          branchId: activeBranchId,
          customerId: selectedCustomer?.id || null,
          saleType: 'walk_in',
          items: saleItems,
          paymentMethod: selectedPay,
          amountPaid,
          discount: discountAmount,
          containersLent,
          containersBack
        });

        setButtonLoading(completeActionTrigger, false);

        if (error) {
          showToast(error.message || 'Transaction failed. Please check network connection.', 'danger');
          return;
        }

        // Keep cart snapshot for the receipt modal
        const purchasedItems = [...cart];

        // Render Slip Modal with real purchased items and cash tender computation
        populateSlipReceiptModal(saleId, grandTotal, selectedPay, containersLent, containersBack, purchasedItems, amountPaid, changeAmount);
        openModal('complete-modal');

        // Reset cart docket & controls
        cart = [];
        const lentInput = document.getElementById('pos-lent-qty');
        const backInput = document.getElementById('pos-back-qty');
        const tenderInput = document.getElementById('pos-tender-input');
        if (lentInput) lentInput.value = '0';
        if (backInput) backInput.value = '0';
        if (tenderInput) tenderInput.value = '';
        document.querySelectorAll('.btn-preset-chip').forEach(c => c.classList.remove('active'));
        if (discountCheckbox) discountCheckbox.checked = false;

        renderProductGrid();
        renderCart();
        updateCashChangeCalculation(0);

        // Refresh shift badge details
        verifyShiftStatus();
      } catch (err) {
        setButtonLoading(completeActionTrigger, false);
        showToast('Offline or network timeout. Please retry.', 'danger');
      }
    });
  }
      }
    });
  }

  // Done & Next Order modal button
  const doneOrderBtn = document.querySelector('[data-action="done-order"]');
  if (doneOrderBtn) {
    doneOrderBtn.addEventListener('click', () => {
      closeModal();
      showToast('Ready for next transaction.', 'success');
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
 * Handles adding Custom / Ad-Hoc Items to the docket.
 */
function setupCustomItemModal() {
  const form = document.getElementById('custom-item-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('custom-item-name');
    const priceInput = document.getElementById('custom-item-price');
    const qtyInput = document.getElementById('custom-item-qty');

    const name = nameInput?.value.trim() || 'Custom Item';
    const price = parseFloat(priceInput?.value) || 0;
    const qty = parseInt(qtyInput?.value, 10) || 1;

    if (price < 0 || qty < 1) {
      showToast('Please enter a valid price and quantity.', 'warning');
      return;
    }

    const customProduct = {
      id: `custom-${Date.now()}`,
      name: name,
      description: 'Custom Station Item',
      price: price,
      category: 'custom',
      product_prices: []
    };

    const existing = cart.find((i) => i.product.name.toLowerCase() === name.toLowerCase() && i.product.price === price);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ product: customProduct, qty });
    }

    form.reset();
    closeModal();
    renderProductGrid();
    renderCart();
    showToast(`Added "${name}" to docket.`, 'success');
  });
}

/**
 * Enables parking and resuming held orders in localStorage.
 */
function setupHoldOrder() {
  const holdBtn = document.querySelector('[data-action="hold-order"]');
  const resumeBtn = document.querySelector('[data-action="resume-order"]');

  function updateResumeBtn() {
    const held = localStorage.getItem('wrsms_held_cart');
    if (resumeBtn) {
      resumeBtn.style.display = held ? 'inline-flex' : 'none';
      if (held) {
        try {
          const parsed = JSON.parse(held);
          resumeBtn.textContent = `Resume Held (${parsed.length})`;
        } catch (_) {
          resumeBtn.textContent = 'Resume Held';
        }
      }
    }
  }

  updateResumeBtn();

  if (holdBtn) {
    holdBtn.addEventListener('click', () => {
      if (cart.length === 0) {
        showToast('Cart is empty. Nothing to hold.', 'warning');
        return;
      }
      localStorage.setItem('wrsms_held_cart', JSON.stringify(cart));
      cart = [];
      renderProductGrid();
      renderCart();
      updateResumeBtn();
      showToast('Order held successfully.', 'info');
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      const held = localStorage.getItem('wrsms_held_cart');
      if (!held) return;
      try {
        cart = JSON.parse(held);
        localStorage.removeItem('wrsms_held_cart');
        renderProductGrid();
        renderCart();
        updateResumeBtn();
        showToast('Held order restored to docket.', 'success');
      } catch (err) {
        showToast('Failed to restore held order.', 'danger');
      }
    });
  }
}

/**
 * Fills details in the #complete-modal receipt for printing.
 */
function populateSlipReceiptModal(
  saleId,
  total,
  paymentMethod,
  lent = 0,
  back = 0,
  items = [],
  amountPaid = 0,
  changeAmount = 0,
  saleNumber = null
) {
  const modal = document.getElementById('complete-modal');
  if (!modal) return;

  const slipShort = saleNumber || (saleId ? `#SLP-${saleId.slice(0, 8).toUpperCase()}` : '#SLP-1049');
  const custName = selectedCustomer ? selectedCustomer.full_name : 'Walk-in Customer';
  const cashierName = currentCashierProfile ? currentCashierProfile.full_name : 'Station Cashier';
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const itemsRows =
    items.length > 0
      ? items
          .map((i) => {
            const unitPrice = getProductPriceForCustomer(i.product);
            const rowTotal = unitPrice * i.qty;
            return `
              <div style="padding: 3px 0; display: flex; justify-content: space-between;">
                <span>${i.qty}x ${escapeHTML(i.product.name)}</span>
                <span>${formatPHP(rowTotal)}</span>
              </div>
            `;
          })
          .join('')
      : `<div style="padding: 3px 0;">Refill Service ................ ${formatPHP(total)}</div>`;

  const bodyEl = modal.querySelector('.modal-body');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="text-align: center; margin-bottom: var(--space-4);">
        <div style="font-size: 1.8rem; font-weight: 800; color: var(--primary);">${formatPHP(total)}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Payment: <strong>${paymentMethod.toUpperCase()}</strong></div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHTML(slipShort)} • Cashier: ${escapeHTML(cashierName)}</div>
      </div>

      <div class="printable-receipt" style="background-color: var(--bg-surface-alt); border-radius: var(--radius-md); padding: var(--space-4); font-family: monospace; font-size: 0.82rem;">
        <div style="text-align: center; font-weight: bold; font-size: 0.95rem;">AQUAFLOW WATER REFILLING</div>
        <div style="text-align: center; font-size: 0.75rem; margin-bottom: 8px;">DOH Permit #0941 • Official Receipt Slip</div>
        <div style="border-top: 1px dashed var(--border-color); padding: 4px 0; display: flex; justify-content: space-between;">
          <span>Slip: ${escapeHTML(slipShort)}</span>
          <span>${dateStr} ${timeStr}</span>
        </div>
        <div style="padding: 2px 0;">Customer: <strong>${escapeHTML(custName)}</strong></div>
        <div style="padding: 2px 0;">Cashier: ${escapeHTML(cashierName)}</div>
        ${
          lent > 0 || back > 0
            ? `<div style="padding: 2px 0; color: var(--primary);">Containers: +${lent} Lent / -${back} Returned</div>`
            : ''
        }
        <div style="border-top: 1px dashed var(--border-color); margin: 6px 0 4px 0;"></div>
        ${itemsRows}
        <div style="border-top: 1px dashed var(--border-color); margin-top: 6px; padding-top: 6px; font-weight: bold; display: flex; justify-content: space-between; font-size: 0.9rem;">
          <span>TOTAL DUE:</span>
          <span style="color: var(--primary);">${formatPHP(total)}</span>
        </div>
        ${
          paymentMethod === 'cash'
            ? `
          <div style="display: flex; justify-content: space-between; padding: 2px 0; font-size: 0.82rem;">
            <span>CASH TENDERED:</span>
            <span>${formatPHP(amountPaid || total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 2px 0; font-size: 0.82rem; font-weight: bold;">
            <span>CHANGE DUE:</span>
            <span>${formatPHP(changeAmount)}</span>
          </div>
        `
            : `
          <div style="display: flex; justify-content: space-between; padding: 2px 0; font-size: 0.82rem;">
            <span>PAID VIA:</span>
            <span>${paymentMethod.toUpperCase()}</span>
          </div>
        `
        }
        <div class="receipt-dashed" style="border-top: 1px dashed var(--border-color); margin-top: 8px; padding-top: 6px; text-align: center; font-size: 0.72rem; color: var(--text-muted);">
          Thank you for choosing AquaFlow Pure Water!<br>
          Please keep this slip for your container deposit records.
        </div>
      </div>
    `;
  }
}

/**
 * Calculates current grand total of the docket.
 */
function getCartGrandTotal() {
  const discountCheckbox = document.getElementById('pos-discount-check') || document.querySelector('.pos-totals-box input[type="checkbox"]');
  const rawSubtotal = cart.reduce((sum, i) => sum + getProductPriceForCustomer(i.product) * i.qty, 0);
  if (discountCheckbox && discountCheckbox.checked) {
    return Math.max(0, rawSubtotal * 0.8);
  }
  return rawSubtotal;
}

/**
 * Updates the cash tender box and computes real-time change due.
 */
function updateCashChangeCalculation(forcedTotal = null) {
  const tenderBox = document.getElementById('pos-cash-tender-box');
  if (!tenderBox) return;

  const selectedPay = document.querySelector('input[name="pay_method"]:checked')?.value || 'cash';
  if (selectedPay !== 'cash') {
    tenderBox.style.display = 'none';
    return;
  }
  tenderBox.style.display = 'block';

  const total = forcedTotal !== null ? forcedTotal : getCartGrandTotal();
  const tenderInput = document.getElementById('pos-tender-input');
  const changeBadge = document.getElementById('pos-change-badge');
  if (!changeBadge) return;

  const valStr = tenderInput?.value.trim() || '';
  if (!valStr || total <= 0) {
    changeBadge.className = 'badge badge-neutral';
    changeBadge.textContent = 'Change: ₱0.00';
    return;
  }

  const tendered = parseFloat(valStr);
  if (isNaN(tendered)) {
    changeBadge.className = 'badge badge-neutral';
    changeBadge.textContent = 'Change: ₱0.00';
    return;
  }

  const change = tendered - total;
  if (change >= 0) {
    changeBadge.className = 'badge badge-success';
    changeBadge.textContent = `Change: ${formatPHP(change)}`;
  } else {
    changeBadge.className = 'badge badge-danger';
    changeBadge.textContent = `Short: -${formatPHP(Math.abs(change))}`;
  }
}

/**
 * Binds quick denomination tender chips and exact payment button.
 */
function setupCashTender() {
  const tenderInput = document.getElementById('pos-tender-input');
  const exactBtn = document.getElementById('btn-tender-exact');
  const presetChips = document.querySelectorAll('.btn-preset-chip');
  const payRadios = document.querySelectorAll('input[name="pay_method"]');

  payRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      updateCashChangeCalculation();
    });
  });

  if (tenderInput) {
    tenderInput.addEventListener('input', () => {
      presetChips.forEach((c) => c.classList.remove('active'));
      updateCashChangeCalculation();
    });
  }

  if (exactBtn) {
    exactBtn.addEventListener('click', () => {
      const total = getCartGrandTotal();
      if (tenderInput) {
        tenderInput.value = total > 0 ? total.toFixed(2) : '';
      }
      presetChips.forEach((c) => c.classList.remove('active'));
      updateCashChangeCalculation();
    });
  }

  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const val = chip.dataset.tender;
      if (tenderInput && val) {
        tenderInput.value = val;
        updateCashChangeCalculation();
      }
    });
  });

  updateCashChangeCalculation();
}

/**
 * Handles the Recent Sales modal and in-POS void workflow with supervisor approval.
 */
function setupRecentSalesModal() {
  const triggerBtn = document.getElementById('btn-recent-sales');
  const refreshBtn = document.getElementById('btn-refresh-recent-sales');

  if (triggerBtn) {
    triggerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('recent-sales-modal');
      loadRecentSales();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadRecentSales();
    });
  }
}

/**
 * Loads recent sales for the active branch and populates the modal list.
 */
async function loadRecentSales() {
  const listEl = document.getElementById('recent-sales-list');
  const countLbl = document.getElementById('recent-sales-count-lbl');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align: center; padding: 32px; color: var(--text-muted);">Loading recent transactions...</div>';

  try {
    const { data: sales, error } = await getRecentSales({ branchId: activeBranchId, limit: 15 });
    if (error || !sales) {
      listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--danger);">Failed to load recent sales.</div>';
      return;
    }

    if (sales.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; padding: 32px; color: var(--text-muted);">No sales recorded for this shift yet.</div>';
      if (countLbl) countLbl.textContent = '0 transactions recorded';
      return;
    }

    if (countLbl) countLbl.textContent = `Showing last ${sales.length} transactions`;

    listEl.innerHTML = sales
      .map((s) => {
        const isVoided = Boolean(s.is_voided);
        const saleDate = formatDate(s.created_at, true);
        const items = Array.isArray(s.items) ? s.items : [];
        const itemsSummary =
          items.length > 0
            ? items.map((it) => `${it.qty}x ${escapeHTML(it.product_name)} (${formatPHP(it.unit_price)})`).join(', ')
            : 'Station Refill / Items';
        const custName = s.customer?.full_name || s.customer_name || 'Walk-in Customer';
        const cashierName = s.cashier_name || 'Cashier';
        const isManagerOrOwner = currentCashierProfile && ['owner', 'manager'].includes(currentCashierProfile.role);

        return `
          <div class="card" style="padding: 12px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); opacity: ${isVoided ? '0.65' : '1'};">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="font-size: 0.9rem; font-family: monospace;">${escapeHTML(s.sale_number || s.id.slice(0, 8))}</strong>
                  <span class="badge ${isVoided ? 'badge-danger' : 'badge-success'}" style="font-size: 0.72rem;">
                    ${isVoided ? 'Voided' : 'Completed'}
                  </span>
                  <span class="badge badge-neutral" style="font-size: 0.72rem; text-transform: uppercase;">
                    ${escapeHTML(s.payment_method)}
                  </span>
                </div>
                <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                  ${saleDate} • Cashier: ${escapeHTML(cashierName)} • Cust: <strong>${escapeHTML(custName)}</strong>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 1.1rem; font-weight: 800; color: ${isVoided ? 'var(--text-muted)' : 'var(--primary)'}; text-decoration: ${isVoided ? 'line-through' : 'none'};">
                  ${formatPHP(s.total)}
                </div>
                ${s.payment_method === 'cash' && s.change_amount > 0 ? `<div style="font-size: 0.72rem; color: var(--text-muted);">Change: ${formatPHP(s.change_amount)}</div>` : ''}
              </div>
            </div>

            <div style="font-size: 0.78rem; color: var(--text-muted); background: var(--bg-surface-alt); padding: 6px 10px; border-radius: var(--radius-sm); margin: 6px 0;">
              ${escapeHTML(itemsSummary)}
            </div>

            ${
              isVoided && s.void_reason
                ? `
              <div style="font-size: 0.75rem; color: var(--danger); font-style: italic; margin-bottom: 6px;">
                Reason for void: "${escapeHTML(s.void_reason)}"
              </div>
            `
                : ''
            }

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
              <button type="button" class="btn btn-secondary btn-sm btn-reprint-sale" data-id="${escapeHTML(s.id)}" style="font-size: 0.75rem; padding: 4px 10px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                <span>Reprint Slip</span>
              </button>
              ${
                !isVoided
                  ? `
                <button type="button" class="btn btn-outline btn-sm btn-void-sale" data-id="${escapeHTML(s.id)}" data-number="${escapeHTML(s.sale_number)}" style="color: var(--danger); border-color: var(--danger); font-size: 0.75rem; padding: 4px 10px;">
                  <span>${isManagerOrOwner ? 'Void Sale' : 'Request Void (PIN)'}</span>
                </button>
              `
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    // Bind Reprint Slip buttons
    listEl.querySelectorAll('.btn-reprint-sale').forEach((btn) => {
      btn.addEventListener('click', () => {
        const saleId = btn.dataset.id;
        const targetSale = sales.find((x) => x.id === saleId);
        if (targetSale) {
          reprintSaleReceipt(targetSale);
        }
      });
    });

    // Bind Void buttons
    listEl.querySelectorAll('.btn-void-sale').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const saleId = btn.dataset.id;
        const saleNumber = btn.dataset.number || 'Sale';
        const isManagerOrOwner = currentCashierProfile && ['owner', 'manager'].includes(currentCashierProfile.role);

        let reason = prompt(`Enter reason for voiding ${saleNumber}:`, 'Customer order cancelled / error');
        if (!reason || !reason.trim()) return;

        let pin = '';
        if (!isManagerOrOwner) {
          pin = prompt(`Supervisor Authorization Required:\nEnter Supervisor / Manager PIN (Default PIN: 1234):`);
          if (!pin) {
            showToast('Void cancelled: Supervisor PIN is required.', 'warning');
            return;
          }
        }

        setButtonLoading(btn, true, 'Voiding...');
        const { error: voidErr } = await rpcVoidSale(saleId, reason.trim(), pin.trim());
        setButtonLoading(btn, false);

        if (voidErr) {
          showToast(voidErr.message || 'Failed to void transaction. Check PIN and permissions.', 'danger');
          return;
        }

        showToast(`Transaction ${saleNumber} voided and stock restored to inventory.`, 'success');
        await loadRecentSales();
        verifyShiftStatus();
      });
    });
  } catch (err) {
    listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--danger);">Network timeout loading transactions.</div>';
  }
}

/**
 * Reprints a historical receipt slip.
 */
function reprintSaleReceipt(sale) {
  const modal = document.getElementById('complete-modal');
  if (!modal) return;

  const items = (sale.items || []).map((it) => ({
    product: { name: it.product_name, price: it.unit_price },
    qty: it.qty
  }));

  populateSlipReceiptModal(
    sale.id,
    Number(sale.total),
    sale.payment_method,
    sale.containers_lent || 0,
    sale.containers_back || 0,
    items,
    Number(sale.amount_paid || sale.total),
    Number(sale.change_amount || 0),
    sale.sale_number
  );

  openModal('complete-modal');
}

