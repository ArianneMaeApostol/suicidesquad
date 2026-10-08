/**
 * @file pages/maintenance.js
 * Controller for maintenance.html: Equipment monitoring, task completion,
 * PNSDW water quality testing, private Storage file uploads, and permit expiration alerts.
 */
import {
  resolveBranchId,
  getEquipment,
  getMaintenanceTasks,
  completeMaintenanceTask,
  getWaterTests,
  addWaterTest,
  getExpiringPermits,
  getSignedFileUrl
} from '../api.js';
import {
  formatDate,
  escapeHTML,
  showToast,
  setButtonLoading,
  openModal,
  closeModal
} from '../ui.js';

let activeBranchId = null;

export async function init({ profile }) {
  activeBranchId = await resolveBranchId();

  await Promise.all([
    loadEquipmentCards(),
    loadWaterTestLogs(),
    loadPermitsList()
  ]);

  setupTestLogModal(profile);
}

/**
 * Loads equipment train cards and maintenance task statuses.
 */
async function loadEquipmentCards() {
  const [eqRes, tasksRes] = await Promise.all([
    getEquipment(activeBranchId),
    getMaintenanceTasks(activeBranchId)
  ]);

  const equipment = eqRes.data || [];
  const tasks = tasksRes.data || [];

  // Update Equipment Cards if dynamic data exists
  const eqGrid = document.querySelector('.content-area > div[style*="grid-template-columns: repeat"]');
  if (!eqGrid || equipment.length === 0) return;

  eqGrid.innerHTML = equipment
    .map((eq) => {
      const eqTasks = tasks.filter((t) => t.equipment_id === eq.id && !t.completed_at);
      const nextTask = eqTasks[0];

      let badge = '<span class="badge badge-success"><span class="badge-dot"></span> Good</span>';
      let border = 'var(--border-color)';

      if (nextTask) {
        const isOverdue = new Date(nextTask.due_date) < new Date();
        if (isOverdue) {
          badge = '<span class="badge badge-danger"><span class="badge-dot"></span> Overdue</span>';
          border = 'var(--danger)';
        } else {
          badge = '<span class="badge badge-warning"><span class="badge-dot"></span> Due Soon</span>';
          border = 'var(--warning)';
        }
      }

      return `
        <div class="card" style="border-color: ${border};">
          <div class="card-header">
            <strong style="font-size: 0.95rem;">${escapeHTML(eq.name)}</strong>
            ${badge}
          </div>
          <div class="card-body" style="font-size: 0.82rem; display: flex; flex-direction: column; gap: 6px;">
            <div>Model / Type: <strong>${escapeHTML(eq.model || 'Standard Unit')}</strong></div>
            <div>Serial #: <strong>${escapeHTML(eq.serial_number || 'N/A')}</strong></div>
            <div>Next Service: <strong>${nextTask ? formatDate(nextTask.due_date, false) : 'None pending'}</strong></div>
          </div>
          <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.74rem; color: var(--text-muted);">${escapeHTML(eq.status || 'Active')}</span>
            ${
              nextTask
                ? `<button type="button" class="btn btn-outline btn-sm" data-action="complete-task" data-id="${nextTask.id}">Mark Done</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  eqGrid.querySelectorAll('[data-action="complete-task"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.id;
      setButtonLoading(btn, true);
      const { error } = await completeMaintenanceTask(taskId);
      setButtonLoading(btn, false);

      if (error) {
        showToast('Failed to complete task.', 'danger');
      } else {
        showToast('Maintenance task marked as completed!', 'success');
        loadEquipmentCards();
      }
    });
  });
}

/**
 * Loads daily water quality test logs (PNSDW standards).
 */
async function loadWaterTestLogs() {
  const tbody = document.querySelector('.table tbody');
  if (!tbody) return;

  const { data: tests, error } = await getWaterTests(activeBranchId);
  if (error || !tests || tests.length === 0) {
    return; // Leave realistic default or empty
  }

  tbody.innerHTML = tests
    .map((t) => {
      const tds = t.tds_ppm ?? t.tds ?? 0;
      const ph = t.ph_level ?? t.ph ?? '7.2';
      const isPassed = t.status === 'passed' || t.status === 'pass' || Number(tds) <= 15;
      const statusBadge = isPassed
        ? '<span class="badge badge-success">Passed PNSDW</span>'
        : '<span class="badge badge-danger">Failed</span>';

      return `
        <tr>
          <td><strong>${formatDate(t.tested_at || t.created_at || t.sample_date)}</strong></td>
          <td><strong style="color: var(--primary);">${tds} ppm</strong></td>
          <td>${ph}</td>
          <td><span class="badge ${t.coliform_passed ? 'badge-success' : 'badge-danger'}">${t.coliform_passed ? 'Negative' : 'Positive'}</span></td>
          <td>${escapeHTML(t.tested_by || 'Maria Santos')}</td>
          <td>
            ${statusBadge}
            ${
              t.attachment_url
                ? ` <button type="button" class="btn btn-ghost btn-sm" data-action="view-cert" data-path="${escapeHTML(t.attachment_url)}" style="padding: 2px 4px;">Cert &rarr;</button>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');

  // Handle signed URL document viewing
  tbody.querySelectorAll('[data-action="view-cert"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const path = btn.dataset.path;
      const url = await getSignedFileUrl(path);
      if (url) {
        window.open(url, '_blank');
      } else {
        showToast('Unable to generate secure download link.', 'danger');
      }
    });
  });
}

/**
 * Loads compliance permits and renewal countdown.
 */
async function loadPermitsList() {
  const { data: permits } = await getExpiringPermits();
  if (!permits || permits.length === 0) return;

  const panel = document.querySelector('.content-area div[style*="display: grid; grid-template-columns: 2fr 1fr;"] .card:last-child .card-body');
  if (!panel) return;

  panel.innerHTML = permits
    .map((p) => {
      const isExpiringSoon = p.days_until_expiry <= 30;
      return `
        <div style="background-color: var(--bg-surface-alt); padding: var(--space-3); border-radius: var(--radius-md); margin-bottom: 8px;">
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(p.type || 'Sanitary Permit')}</div>
          <div style="font-weight: 700; font-family: monospace; font-size: 0.95rem; color: var(--primary);">${escapeHTML(p.permit_number || 'PERMIT-2026')}</div>
          <div style="font-size: 0.72rem; color: ${isExpiringSoon ? 'var(--danger)' : 'var(--success)'}; margin-top: 2px;">
            Expires: ${formatDate(p.expires_at, false)} (${p.days_until_expiry} days)
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Sets up water test log recording with file upload support.
 * @param {object} profile
 */
function setupTestLogModal(profile) {
  const modal = document.getElementById('test-log-modal');
  if (!modal) return;
  const form = modal.querySelector('form');
  if (!form) return;

  // Add file attachment input if not present
  if (!modal.querySelector('#test-file-input')) {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'form-group';
    fileGroup.innerHTML = `
      <label class="form-label" for="test-file-input">Lab Certificate Attachment (Optional PDF/Image)</label>
      <input type="file" id="test-file-input" class="form-control" accept="image/*,.pdf">
    `;
    form.querySelector('.modal-body').appendChild(fileGroup);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const tdsVal = Number(document.getElementById('tds-val')?.value) || 0;
    const phVal = Number(document.getElementById('ph-val')?.value) || 7.0;
    const testerName = document.getElementById('tester-name')?.value || profile?.full_name || 'Staff';
    const fileInput = document.getElementById('test-file-input');
    const file = fileInput?.files ? fileInput.files[0] : null;
    const submitBtn = form.querySelector('button[type="submit"]');

    setButtonLoading(submitBtn, true, 'Logging Test...');

    const { data, error } = await addWaterTest(
      {
        branch_id: activeBranchId,
        tds_ppm: tdsVal,
        ph_level: phVal,
        coliform_passed: true,
        status: tdsVal <= 15 ? 'passed' : 'failed',
        tested_by: testerName,
        tested_at: new Date().toISOString()
      },
      file
    );

    setButtonLoading(submitBtn, false);

    if (error) {
      showToast(error.message || 'Error recording water test.', 'danger');
      return;
    }

    showToast('Water test log recorded successfully!', 'success');
    form.reset();
    closeModal(modal);
    loadWaterTestLogs();
  });
}
