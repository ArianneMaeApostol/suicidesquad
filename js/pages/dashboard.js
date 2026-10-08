/**
 * @file pages/dashboard.js
 * Controller for dashboard.html: KPI statistics, 7-day sales chart, alerts, and recent sales table.
 */
import {
  resolveBranchId,
  getTodayDailySales,
  getRecentDailySales,
  getLowStockAlerts,
  getUpcomingMaintenance,
  getDashboardMetrics,
  getRecentSales
} from '../api.js';
import { formatPHP, formatDate, escapeHTML, renderSkeleton, renderEmptyState } from '../ui.js';

export async function init({ profile }) {
  const branchId = await resolveBranchId();

  // Load dashboard widgets concurrently
  await Promise.all([
    loadKpiMetrics(branchId),
    loadSalesChart(branchId),
    loadAlerts(branchId),
    loadRecentSales(branchId)
  ]);
}

/**
 * Loads and renders the 4 primary KPI cards.
 * @param {string|null} branchId
 */
async function loadKpiMetrics(branchId) {
  try {
    const [{ data: todaySales }, metrics] = await Promise.all([
      getTodayDailySales(branchId),
      getDashboardMetrics(branchId)
    ]);

    // KPI 1: Today's Sales Revenue
    const salesEl = document.querySelector('[data-kpi="sales-val"]') || document.querySelectorAll('.kpi-value')[0];
    if (salesEl) {
      const total = todaySales ? Number(todaySales.total_sales) || 0 : 0;
      salesEl.textContent = formatPHP(total);
    }

    // KPI 2: Gallons Refilled (Transactions or gallons)
    const gallonsEl = document.querySelector('[data-kpi="gallons-val"]') || document.querySelectorAll('.kpi-value')[1];
    if (gallonsEl) {
      const txCount = todaySales ? todaySales.transactions || 0 : 0;
      // Estimation: approximate gallons or transaction count
      gallonsEl.innerHTML = `${txCount * 5 || 0} <span style="font-size: 1rem; font-weight: 500; color: var(--text-muted);">gals</span>`;
    }

    // KPI 3: Pending Deliveries
    const delivEl = document.querySelector('[data-kpi="deliveries-val"]') || document.querySelectorAll('.kpi-value')[2];
    if (delivEl) {
      delivEl.innerHTML = `${metrics.pendingDeliveries || 0} <span style="font-size: 1rem; font-weight: 500; color: var(--text-muted);">orders</span>`;
      const delivCard = delivEl.closest('.kpi-card');
      if (delivCard && (metrics.outForDeliveryCount !== undefined || metrics.queuedDeliveries !== undefined)) {
        const bottom = delivCard.querySelector('.kpi-bottom');
        if (bottom) {
          bottom.innerHTML = `
            <span class="badge badge-warning" data-kpi="deliveries-out">${metrics.outForDeliveryCount || 0} Out with Riders</span>
            <span style="color: var(--text-muted); margin-left: auto;" data-kpi="deliveries-queued">${metrics.queuedDeliveries || 0} Queued</span>
          `;
        }
      }
    }

    // KPI 4: Outstanding Customer Balances
    const balanceEl = document.querySelector('[data-kpi="balance-val"]') || document.querySelectorAll('.kpi-value')[3];
    if (balanceEl) {
      balanceEl.textContent = formatPHP(metrics.totalBalance);
    }
  } catch (err) {
    console.error('Failed to load KPI metrics:', err);
  }
}

/**
 * Renders the CSS bar sales chart for the last 7 days.
 * @param {string|null} branchId
 */
async function loadSalesChart(branchId) {
  const chartWrapper = document.querySelector('[data-chart="sales"]') || document.querySelector('.chart-bars-wrapper');
  if (!chartWrapper) return;

  try {
    const { data: salesList } = await getRecentDailySales(branchId, 7);
    if (!salesList || salesList.length === 0) {
      chartWrapper.innerHTML = '<div style="margin: auto; color: var(--text-muted); font-size: 0.85rem;">No recent sales data recorded.</div>';
      return;
    }

    // Find maximum sales amount for scaling percentages
    const maxSale = Math.max(...salesList.map((s) => Number(s.total_sales) || 1), 1000);

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    chartWrapper.innerHTML = salesList
      .map((entry) => {
        const d = new Date(entry.day);
        const dayLabel = daysOfWeek[d.getDay()];
        const amt = Number(entry.total_sales) || 0;
        const heightPct = Math.max(Math.round((amt / maxSale) * 100), 8);
        const isToday = new Date().toISOString().split('T')[0] === entry.day;

        const pillBg = isToday
          ? 'background: linear-gradient(180deg, #16A34A 0%, #15803D 100%);'
          : '';

        return `
          <div class="chart-bar-group">
            <div class="chart-bar-pill" style="height: ${heightPct}%; ${pillBg}">
              <div class="chart-bar-tooltip">${dayLabel}: ${formatPHP(amt)} (${entry.transactions || 0} orders)</div>
            </div>
            <span class="chart-bar-day" ${isToday ? 'style="font-weight: 700; color: var(--primary);"' : ''}>${dayLabel}</span>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load sales chart:', err);
  }
}

/**
 * Loads low-stock items and upcoming equipment maintenance tasks.
 * @param {string|null} branchId
 */
async function loadAlerts(branchId) {
  const alertsContainer = document.querySelector('[data-section="alerts"]') || document.querySelector('.card-body:has(.alert-warning)');
  const maintenanceList = document.querySelector('[data-section="maintenance-reminders"]') || document.querySelector('.card:has(a[href="maintenance.html"]) .card-body');

  try {
    const [{ data: lowStock }, { data: maintenance }] = await Promise.all([
      getLowStockAlerts(),
      getUpcomingMaintenance()
    ]);

    // Populate Low Stock Alert Box if items exist
    if (alertsContainer && lowStock && lowStock.length > 0) {
      const criticalItem = lowStock[0];
      const alertHtml = `
        <div class="alert alert-warning" style="margin-bottom: 12px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <strong style="display: block;">Low Stock: ${escapeHTML(criticalItem.name || 'Consumable')}</strong>
            <span style="font-size: 0.78rem;">Remaining: ${criticalItem.quantity || 0} (Min threshold: ${criticalItem.reorder_level || 0}).</span>
          </div>
        </div>
      `;
      alertsContainer.innerHTML = alertHtml;
    }

    // Populate Maintenance Reminders
    if (maintenanceList && maintenance && maintenance.length > 0) {
      maintenanceList.innerHTML = maintenance
        .slice(0, 4)
        .map((task) => {
          const isOverdue = new Date(task.due_date) < new Date();
          const borderCol = isOverdue ? 'var(--danger)' : 'var(--warning)';
          const badgeClass = isOverdue ? 'badge-danger' : 'badge-warning';

          return `
            <div style="border-left: 3px solid ${borderCol}; padding-left: var(--space-3); margin-bottom: 12px;">
              <div style="font-size: 0.85rem; font-weight: 700;">${escapeHTML(task.title || task.equipment_name || 'Machine Service')}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Due: ${formatDate(task.due_date, false)}</div>
              <span class="badge ${badgeClass}" style="margin-top: 4px;">${isOverdue ? 'Overdue' : 'Due Soon'}</span>
            </div>
          `;
        })
        .join('');
    }
  } catch (err) {
    console.error('Failed to load alerts:', err);
  }
}

/**
 * Loads the 10 most recent transactions table.
 * @param {string|null} branchId
 */
async function loadRecentSales(branchId) {
  const tbody = document.querySelector('[data-table="recent-sales"]') || document.querySelector('.table tbody');
  if (!tbody) return;

  renderSkeleton(tbody, 4);

  try {
    const { data: sales, error } = await getRecentSales({ branchId, limit: 10 });
    if (error || !sales || sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No transactions recorded today yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = sales
      .map((sale) => {
        const customerName = sale.customers ? sale.customers.full_name : 'Walk-in Customer';
        const phone = sale.customers?.phone ? sale.customers.phone : '';
        const itemsSummary = (sale.sale_items || [])
          .map((item) => `${item.qty}x ${item.products?.name || 'Refill'}`)
          .join(', ') || 'Refill Gallons';

        const slipId = sale.id ? `#SLP-${sale.id.slice(0, 6).toUpperCase()}` : '#SLP-0000';
        const methodBadges = {
          cash: 'badge-neutral',
          gcash: 'badge-primary',
          maya: 'badge-info',
          credit: 'badge-warning'
        };
        const badgeCls = methodBadges[sale.payment_method] || 'badge-neutral';

        return `
          <tr>
            <td><strong style="color: var(--primary); font-family: monospace;">${escapeHTML(slipId)}</strong></td>
            <td>
              <div style="font-weight: 600;">${escapeHTML(customerName)}</div>
              <div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHTML(phone || sale.sale_type || 'Counter')}</div>
            </td>
            <td style="font-size: 0.82rem;">${escapeHTML(itemsSummary)}</td>
            <td><span class="badge ${badgeCls}">${escapeHTML((sale.payment_method || 'cash').toUpperCase())}</span></td>
            <td><strong>${formatPHP(sale.total_amount || 0)}</strong></td>
            <td><span class="badge badge-success"><span class="badge-dot"></span> Completed</span></td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load recent sales:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 16px;">Failed to load transactions.</td></tr>`;
  }
}
