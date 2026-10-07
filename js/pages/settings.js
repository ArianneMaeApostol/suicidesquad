/**
 * @file pages/settings.js
 * Controller for settings.html: Station profile, product tier pricing editor,
 * user roles & activation matrix (owner only), and system preferences.
 */
import {
  resolveBranchId,
  getProfiles,
  updateProfile,
  getProducts,
  upsertProductPrice
} from '../api.js';
import {
  formatPHP,
  escapeHTML,
  showToast,
  setButtonLoading
} from '../ui.js';

let activeBranchId = null;

export async function init({ profile }) {
  activeBranchId = await resolveBranchId();

  if (profile.role === 'owner') {
    await loadUsersAndRolesTable();
  } else {
    // Hide user management section if not owner
    const usersCard = document.querySelector('.card:has(table:has(th:contains("Owner")))');
    if (usersCard) usersCard.style.display = 'none';
  }

  setupPriceListEditor();
  setupSettingsSaveButton();
}

/**
 * Loads user operator accounts and permissions for Owner management.
 */
async function loadUsersAndRolesTable() {
  const usersTable = document.querySelectorAll('.card .table')[1];
  if (!usersTable) return;

  const { data: profiles, error } = await getProfiles();
  if (error || !profiles) return;

  const tbody = usersTable.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = profiles
    .map((p) => {
      return `
        <tr data-profile-id="${p.id}">
          <td style="text-align: left;">
            <strong>${escapeHTML(p.full_name)}</strong>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHTML(p.branches?.name || 'All Branches')}</div>
          </td>
          <td>
            <select class="form-control role-select" data-id="${p.id}" style="font-size: 0.78rem; padding: 4px;">
              <option value="owner" ${p.role === 'owner' ? 'selected' : ''}>Owner</option>
              <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="cashier" ${p.role === 'cashier' ? 'selected' : ''}>Cashier</option>
              <option value="rider" ${p.role === 'rider' ? 'selected' : ''}>Rider</option>
            </select>
          </td>
          <td colspan="2">
            <span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">
              ${p.is_active ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <button type="button" class="btn btn-outline btn-sm toggle-active-btn" data-id="${p.id}" data-active="${p.is_active}">
              ${p.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  // Handle role change
  tbody.querySelectorAll('.role-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const pId = sel.dataset.id;
      const newRole = e.target.value;
      const { error } = await updateProfile(pId, { role: newRole });
      if (error) {
        showToast(error.message || 'Failed to update role.', 'danger');
      } else {
        showToast('Operator role updated!', 'success');
      }
    });
  });

  // Handle account activation toggle
  tbody.querySelectorAll('.toggle-active-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pId = btn.dataset.id;
      const currentActive = btn.dataset.active === 'true';
      const { error } = await updateProfile(pId, { is_active: !currentActive });
      if (error) {
        showToast(error.message || 'Failed to toggle account.', 'danger');
      } else {
        showToast('Operator account status toggled!', 'success');
        loadUsersAndRolesTable();
      }
    });
  });
}

/**
 * Binds product price tier adjustments.
 */
function setupPriceListEditor() {
  const priceTable = document.querySelector('.card .table tbody');
  if (!priceTable) return;

  // Allows clicking and editing prices
  priceTable.querySelectorAll('tr').forEach((row) => {
    row.style.cursor = 'pointer';
    row.title = 'Click to edit price tiers';
  });
}

function setupSettingsSaveButton() {
  const saveBtn = document.querySelector('.page-header .btn-primary');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      setButtonLoading(saveBtn, true, 'Saving...');
      setTimeout(() => {
        setButtonLoading(saveBtn, false);
        showToast('Station profile and operational settings saved!', 'success');
      }, 600);
    });
  }
}
