/**
 * @file api.js
 * Standardized data access layer communicating with the Python FastAPI + MongoDB backend.
 * Every function maintains the contract: returns { data, error }.
 */
import { API_BASE_URL, getToken, getStoredBranchId, setStoredBranchId } from './config.js';
import { getCurrentProfile } from './auth.js';

/**
 * Universal fetch wrapper that attaches Authorization bearer tokens and formats results.
 * @param {string} endpoint
 * @param {RequestInit} [options={}]
 * @returns {Promise<{ data: any, error: Error|null }>}
 */
async function apiFetch(endpoint, options = {}) {
  try {
    const token = getToken();
    const headers = { ...(options.headers || {}) };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = text;
    }

    if (!res.ok) {
      const errorMsg = json?.detail || (typeof json === 'string' ? json : 'API Request Failed');
      return { data: null, error: new Error(errorMsg) };
    }

    return { data: json, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Resolves the branch ID to query: profile's branch for cashier/manager/rider,
 * or stored active branch for owner.
 * @returns {Promise<string|null>}
 */
export async function resolveBranchId() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (profile.role === 'owner') {
    const stored = getStoredBranchId();
    // If stored value is a dummy slug or missing, fall back to real branch
    const isDummySlug = !stored || ['pasig', 'mandaluyong', 'marikina'].includes(stored.toLowerCase());
    if (!isDummySlug) {
      return stored;
    }
    if (profile.branch_id) {
      setStoredBranchId(profile.branch_id);
      return profile.branch_id;
    }
    const { data: branches } = await getBranches();
    if (branches && branches.length > 0) {
      setStoredBranchId(branches[0].id);
      return branches[0].id;
    }
    return null;
  }
  return profile.branch_id;
}

// ============================================================================
// 1. SALES & TRANSACTIONS
// ============================================================================

/**
 * Creates a sale transaction.
 */
export async function rpcCreateSale({
  branchId,
  customerId,
  saleType,
  items,
  paymentMethod,
  amountPaid,
  discount = 0,
  containersLent = 0,
  containersBack = 0
}) {
  return apiFetch('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: branchId,
      customer_id: customerId || null,
      sale_type: saleType,
      items: items,
      payment_method: paymentMethod,
      amount_paid: Number(amountPaid) || 0,
      discount: Number(discount) || 0,
      containers_lent: Number(containersLent) || 0,
      containers_back: Number(containersBack) || 0
    })
  });
}

/**
 * Records an account payment for a customer.
 */
export async function rpcRecordPayment({ customerId, amount, method, reference = '' }) {
  return apiFetch('/api/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customerId,
      amount: Number(amount),
      method: method,
      reference: reference || null
    })
  });
}

/**
 * Voids an existing sale.
 */
export async function rpcVoidSale(saleId, reason = 'Voided by supervisor', supervisorPasscode = '') {
  return apiFetch(`/api/sales/${saleId}/void`, {
    method: 'POST',
    body: JSON.stringify({
      reason: reason || 'Voided by supervisor',
      supervisor_passcode: supervisorPasscode || undefined
    })
  });
}


// ============================================================================
// 2. SHIFTS
// ============================================================================

/**
 * Opens a new POS shift.
 */
export async function rpcOpenShift(branchId, openingCash) {
  return apiFetch('/api/shifts/open', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: branchId,
      opening_cash: Number(openingCash) || 0
    })
  });
}

/**
 * Closes an active POS shift.
 */
export async function rpcCloseShift(shiftId, countedCash) {
  return apiFetch('/api/shifts/close', {
    method: 'POST',
    body: JSON.stringify({
      shift_id: shiftId,
      counted_cash: Number(countedCash) || 0
    })
  });
}

/**
 * Gets the current active shift for a branch.
 */
export async function getActiveShift(branchId) {
  return apiFetch(`/api/shifts/active?branch_id=${branchId}`);
}

// ============================================================================
// 3. DASHBOARD, REPORTS & ANALYTICS
// ============================================================================

/**
 * Fetches today's sales summary.
 */
export async function getTodayDailySales(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/reports/daily${query}`);
}

/**
 * Fetches recent daily sales for charts (past 7 to 30 days).
 */
export async function getRecentDailySales(branchId, days = 7) {
  const query = `?days=${days}${branchId ? `&branch_id=${branchId}` : ''}`;
  return apiFetch(`/api/reports/recent-daily${query}`);
}

/**
 * Fetches items below reorder point.
 */
export async function getLowStockAlerts() {
  return apiFetch('/api/inventory/low-stock');
}

/**
 * Fetches upcoming maintenance tasks.
 */
export async function getUpcomingMaintenance() {
  return apiFetch('/api/maintenance/upcoming');
}

/**
 * Fetches permits expiring soon.
 */
export async function getExpiringPermits() {
  return apiFetch('/api/maintenance/permits/expiring');
}

/**
 * Fetches dashboard summary counts.
 */
export async function getDashboardMetrics(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  const { data, error } = await apiFetch(`/api/reports/dashboard-metrics${query}`);
  if (error || !data) {
    return { pendingDeliveries: 0, totalBalance: 0, customersWithBalance: 0 };
  }
  return data;
}

// ============================================================================
// 4. PRODUCTS & PRICING
// ============================================================================

/**
 * Fetches active products with customer-tier prices.
 */
export async function getProducts(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/products${query}`);
}

/**
 * Creates a new station product.
 */
export async function createProduct({ name, unit = 'pcs', category = 'custom', description = 'Custom Station Item', price, branchId }) {
  return apiFetch('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name,
      unit,
      category,
      description,
      price: Number(price) || 0,
      branch_id: branchId || null
    })
  });
}


/**
 * Updates product price for a specific customer tier.
 */
export async function upsertProductPrice(productId, customerType, price) {
  return apiFetch(`/api/products/${productId}/prices`, {
    method: 'POST',
    body: JSON.stringify({
      customer_type: customerType,
      price: Number(price)
    })
  });
}

// ============================================================================
// 5. CUSTOMERS
// ============================================================================

/**
 * Fetches customers with pagination, search, and type filter.
 */
export async function getCustomers({ search = '', type = 'all', page = 1, pageSize = 15 }) {
  const params = new URLSearchParams({
    search: search.trim(),
    type: type,
    page: String(page),
    limit: String(pageSize)
  });
  const { data, error } = await apiFetch(`/api/customers?${params.toString()}`);
  if (error) {
    return { data: [], total: 0, error };
  }
  return {
    data: data.data || [],
    total: data.total || 0,
    error: null
  };
}

/**
 * Fetches single customer profile by ID.
 */
export async function getCustomerById(customerId) {
  return apiFetch(`/api/customers/${customerId}`);
}

/**
 * Creates a new customer record.
 */
export async function createCustomer(customerData) {
  return apiFetch('/api/customers', {
    method: 'POST',
    body: JSON.stringify(customerData)
  });
}

/**
 * Updates an existing customer record.
 */
export async function updateCustomer(id, customerData) {
  return apiFetch(`/api/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(customerData)
  });
}

/**
 * Fetches container ledger history for a customer.
 */
export async function getCustomerContainerLedger(customerId) {
  return apiFetch(`/api/customers/${customerId}/container-ledger`);
}

/**
 * Fetches payment history for a customer.
 */
export async function getCustomerPayments(customerId) {
  return apiFetch(`/api/customers/${customerId}/payments`);
}

// ============================================================================
// 6. RECENT SALES
// ============================================================================

/**
 * Fetches recent sales list for a branch or customer.
 */
export async function getRecentSales({ branchId, customerId, limit = 10 } = {}) {
  const params = new URLSearchParams();
  if (branchId) params.append('branch_id', branchId);
  if (customerId) params.append('customer_id', customerId);
  if (limit) params.append('limit', String(limit));
  return apiFetch(`/api/sales?${params.toString()}`);
}

// ============================================================================
// 7. DELIVERIES & REALTIME SSE
// ============================================================================

/**
 * Fetches delivery orders for a branch or assigned rider.
 */
export async function getDeliveries({ branchId, riderId } = {}) {
  const params = new URLSearchParams();
  if (branchId) params.append('branch_id', branchId);
  if (riderId) params.append('rider_id', riderId);
  return apiFetch(`/api/deliveries?${params.toString()}`);
}

/**
 * Subscribes to realtime delivery order events using Server-Sent Events (SSE).
 * @param {string|null} branchId
 * @param {Function} onChange Callback triggered on changes
 * @returns {{ unsubscribe: Function }}
 */
export function subscribeDeliveries(branchId, onChange) {
  const url = `${API_BASE_URL}/api/deliveries/stream${branchId ? `?branch_id=${branchId}` : ''}`;
  const es = new EventSource(url);

  es.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (onChange) onChange(parsed);
    } catch (e) {
      if (onChange) onChange(event.data);
    }
  };

  es.onerror = (err) => {
    console.warn('Deliveries SSE stream reconnecting...', err);
  };

  return {
    unsubscribe: () => es.close(),
    close: () => es.close()
  };
}

/**
 * Fetches delivery riders for a branch.
 */
export async function getRiders(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/deliveries/riders${query}`);
}

/**
 * Creates a new delivery trip / order.
 */
export async function createDelivery(data) {
  return apiFetch('/api/deliveries', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

/**
 * Assigns a delivery order to a rider.
 */
export async function assignDeliveryRider(deliveryId, riderId) {
  return apiFetch(`/api/deliveries/${deliveryId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ rider_id: riderId })
  });
}

/**
 * Updates delivery status.
 */
export async function rpcSetDeliveryStatus(deliveryId, status) {
  return apiFetch(`/api/deliveries/${deliveryId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

// ============================================================================
// 8. INVENTORY & STOCK MOVEMENTS
// ============================================================================

/**
 * Fetches stock inventory items.
 */
export async function getInventory(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/inventory${query}`);
}

/**
 * Fetches suppliers list.
 */
export async function getSuppliers() {
  return apiFetch('/api/inventory/suppliers');
}

/**
 * Records a stock movement (stock in / stock out).
 */
export async function createStockMovement(movementData) {
  return apiFetch('/api/inventory/movements', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: movementData.branch_id,
      item_id: movementData.item_id,
      type: movementData.type,
      qty: Number(movementData.qty ?? movementData.quantity ?? 0),
      note: movementData.note ?? movementData.notes ?? ''
    })
  });
}

// ============================================================================
// 9. MAINTENANCE, WATER TESTS & COMPLIANCE
// ============================================================================

/**
 * Fetches equipment list.
 */
export async function getEquipment(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/maintenance/equipment${query}`);
}

/**
 * Fetches maintenance tasks.
 */
export async function getMaintenanceTasks(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/maintenance/tasks${query}`);
}

/**
 * Marks a maintenance task as completed.
 */
export async function completeMaintenanceTask(taskId) {
  return apiFetch(`/api/maintenance/tasks/${taskId}/complete`, {
    method: 'PATCH'
  });
}

/**
 * Fetches water quality test logs.
 */
export async function getWaterTests(branchId) {
  const query = branchId ? `?branch_id=${branchId}` : '';
  return apiFetch(`/api/maintenance/water-tests${query}`);
}

/**
 * Creates a water test log entry, with optional attachment upload.
 */
export async function addWaterTest(testData, file = null) {
  let certUrl = null;

  if (file) {
    const formData = new FormData();
    formData.append('file', file);
    const { data: uploadRes, error: uploadErr } = await apiFetch('/api/maintenance/upload', {
      method: 'POST',
      body: formData
    });
    if (uploadErr) return { data: null, error: uploadErr };
    certUrl = uploadRes?.url || uploadRes?.path || null;
  }

  return apiFetch('/api/maintenance/water-tests', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: testData.branch_id,
      ph: testData.ph_level ?? testData.ph,
      ph_level: testData.ph_level ?? testData.ph,
      tds: testData.tds_ppm ?? testData.tds,
      tds_ppm: testData.tds_ppm ?? testData.tds,
      bacteria_result: testData.coliform_passed ? 'Negative' : 'Positive',
      result: (testData.status === 'passed' || (testData.tds_ppm && testData.tds_ppm <= 15)) ? 'pass' : 'fail',
      status: testData.status,
      certificate_path: certUrl,
      attachment_url: certUrl,
      tested_by: testData.tested_by,
      tested_at: testData.tested_at
    })
  });
}

/**
 * Generates viewing URL for uploaded compliance attachments.
 */
export async function getSignedFileUrl(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  return `${API_BASE_URL}${filePath.startsWith('/') ? filePath : '/' + filePath}`;
}

// ============================================================================
// 10. EXPENSES
// ============================================================================

/**
 * Fetches expenses with date range filtering.
 */
export async function getExpenses({ branchId, startDate, endDate } = {}) {
  const params = new URLSearchParams();
  if (branchId) params.append('branch_id', branchId);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  return apiFetch(`/api/expenses?${params.toString()}`);
}

/**
 * Creates an operating expense entry.
 */
export async function createExpense(expenseData) {
  return apiFetch('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({
      branch_id: expenseData.branch_id,
      category: expenseData.category,
      amount: Number(expenseData.amount) || 0,
      description: expenseData.description,
      payment_method: expenseData.payment_method || expenseData.payment_mode || 'cash',
      payment_mode: expenseData.payment_mode || expenseData.payment_method || 'cash',
      date: expenseData.date ? expenseData.date.split('T')[0] : new Date().toISOString().split('T')[0],
      reference_no: expenseData.reference_no || null
    })
  });
}

// ============================================================================
// 11. BRANCHES & USER PROFILES
// ============================================================================

/**
 * Fetches all branches in the system.
 */
export async function getBranches() {
  return apiFetch('/api/branches');
}

/**
 * Fetches all operator profiles (owner/manager).
 */
export async function getProfiles() {
  return apiFetch('/api/users');
}

/**
 * Updates a user account (role, active state).
 */
export async function updateProfile(id, updates) {
  return apiFetch(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}
