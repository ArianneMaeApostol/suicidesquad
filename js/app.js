/**
 * @file app.js
 * Master application bootstrap executed on all pages.
 * Enforces session guards, hydrates user profile cards, manages branch switching,
 * handles role-based navigation visibility, and lazy-loads the page module.
 */
import { requireAuth, getSession, getCurrentProfile, signOut, setupAuthListener, getHomeUrlForRole } from './auth.js';
import { getBranches, resolveBranchId } from './api.js';
import { getStoredBranchId, setStoredBranchId } from './config.js';
import { showToast, escapeHTML } from './ui.js';

/**
 * Role permissions mapping for page-level access.
 */
const PAGE_PERMISSIONS = {
  dashboard: ['owner', 'manager', 'cashier'],
  pos: ['owner', 'manager', 'cashier'],
  deliveries: ['owner', 'manager', 'cashier', 'rider'],
  customers: ['owner', 'manager', 'cashier'],
  'customer-profile': ['owner', 'manager', 'cashier'],
  inventory: ['owner', 'manager', 'cashier'],
  maintenance: ['owner', 'manager', 'cashier'],
  expenses: ['owner', 'manager', 'cashier'],
  reports: ['owner', 'manager'],
  settings: ['owner', 'manager']
};

/**
 * Initializes the current page.
 */
async function bootstrap() {
  const page = document.body.dataset.page || '';

  // Setup auth state listener for session drops
  setupAuthListener();

  // Handle Login Page
  if (page === 'login') {
    const session = await getSession();
    if (session) {
      const profile = await getCurrentProfile();
      if (profile) {
        window.location.href = getHomeUrlForRole(profile.role);
        return;
      }
    }
    loadPageModule(page, null);
    return;
  }

  // Handle 404 Page (public)
  if (page === '404') {
    return;
  }

  // Enforce authentication & role restrictions for protected pages
  const allowedRoles = PAGE_PERMISSIONS[page] || [];
  const auth = await requireAuth(allowedRoles);
  if (!auth) return;

  const { profile, session } = auth;

  // Hydrate user info across UI
  hydrateUserElements(profile);

  // Setup branch selector / display
  await setupBranchHeader(profile);

  // Filter sidebar navigation by role
  filterNavigation(profile.role);

  // Bind logout actions
  bindLogoutActions();

  // Load and initialize the page-specific controller
  loadPageModule(page, { profile, session });
}

/**
 * Updates user name, role badge, and initials in sidebar & dropdown.
 * @param {object} profile
 */
function hydrateUserElements(profile) {
  const initials = profile.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  const roleLabels = {
    owner: 'Station Owner',
    manager: 'Station Manager',
    cashier: 'Head Cashier',
    rider: 'Delivery Rider'
  };

  const roleText = roleLabels[profile.role] || profile.role;

  // Sidebar User Card
  document.querySelectorAll('[data-user-name]').forEach((el) => {
    el.textContent = profile.full_name;
  });

  document.querySelectorAll('[data-user-role]').forEach((el) => {
    el.textContent = roleText;
  });

  document.querySelectorAll('[data-user-avatar]').forEach((el) => {
    el.textContent = initials;
  });

  // Fallback selectors in existing static HTML
  const sidebarUserName = document.querySelector('.sidebar-user .user-name');
  if (sidebarUserName && !sidebarUserName.hasAttribute('data-user-name')) {
    sidebarUserName.textContent = profile.full_name;
  }
  const sidebarUserRole = document.querySelector('.sidebar-user .user-role');
  if (sidebarUserRole && !sidebarUserRole.hasAttribute('data-user-role')) {
    sidebarUserRole.textContent = roleText;
  }
  const sidebarAvatar = document.querySelector('.sidebar-user .avatar');
  if (sidebarAvatar && !sidebarAvatar.hasAttribute('data-user-avatar')) {
    sidebarAvatar.textContent = initials;
  }

  const dropdownHeaderName = document.querySelector('.dropdown-header .name');
  if (dropdownHeaderName) dropdownHeaderName.textContent = profile.full_name;
  const dropdownHeaderSub = document.querySelector('.dropdown-header .sub');
  if (dropdownHeaderSub) dropdownHeaderSub.textContent = `${roleText} • WRSMS`;
  const topbarAvatar = document.querySelector('.avatar-btn .avatar');
  if (topbarAvatar) topbarAvatar.textContent = initials;
}

/**
 * Configures the branch indicator in topbar, rendering an interactive switcher for owners.
 * @param {object} profile
 */
async function setupBranchHeader(profile) {
  const breadcrumbBranch = document.querySelector('.topbar-breadcrumb span:first-child');
  const customBranchContainer = document.querySelector('[data-branch-container]');

  const { data: branches } = await getBranches();
  const branchList = branches || [];

  if (profile.role === 'owner') {
    let activeId = getStoredBranchId();
    const validBranch = branchList.find((b) => b.id === activeId);
    if (!validBranch && branchList.length > 0) {
      activeId = branchList[0].id;
      setStoredBranchId(activeId);
    }

    const selectHtml = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">BRANCH:</span>
        <select id="owner-branch-select" class="form-control" style="font-size: 0.8rem; padding: 3px 8px; width: auto; height: 30px; border-radius: var(--radius-sm); font-weight: 600;">
          ${branchList
        .map(
          (b) => `<option value="${escapeHTML(b.id)}" ${b.id === activeId ? 'selected' : ''}>${escapeHTML(b.name)}</option>`
        )
        .join('')}
        </select>
      </div>
    `;

    if (customBranchContainer) {
      customBranchContainer.innerHTML = selectHtml;
    } else if (breadcrumbBranch) {
      breadcrumbBranch.innerHTML = selectHtml;
    }

    const selectEl = document.getElementById('owner-branch-select');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        setStoredBranchId(e.target.value);
        showToast('Active branch switched.', 'info');
        window.location.reload();
      });
    }
  } else {
    // Normal user: display assigned branch name
    const myBranch = branchList.find((b) => b.id === profile.branch_id);
    const branchName = myBranch ? myBranch.name : 'Maramag Main';
    const text = `Branch: ${branchName}`;

    if (customBranchContainer) {
      customBranchContainer.textContent = text;
    } else if (breadcrumbBranch) {
      breadcrumbBranch.textContent = text;
    }
  }
}

/**
 * Hides navigation items in sidebar that current role cannot access.
 * @param {string} role
 */
function filterNavigation(role) {
  document.querySelectorAll('.sidebar-nav .nav-link').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const pageName = href.replace('.html', '').replace(/^\//, '');

    const allowed = PAGE_PERMISSIONS[pageName];
    if (allowed && !allowed.includes(role)) {
      const li = link.closest('li');
      if (li) {
        li.style.display = 'none';
      } else {
        link.style.display = 'none';
      }
    }
  });

  // Specifically for Rider: only Deliveries is primary
  if (role === 'rider') {
    const groupTitles = document.querySelectorAll('.nav-group-title');
    groupTitles.forEach((t) => {
      if (t.textContent.includes('Station Management')) {
        t.parentElement.style.display = 'none';
      }
    });
  }
}

/**
 * Binds logout click events across all logout buttons.
 */
function bindLogoutActions() {
  const logoutTargets = document.querySelectorAll(
    '[data-action="logout"], .sidebar-user a[title="Sign Out"], .dropdown-item.danger'
  );

  logoutTargets.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to log out from this station terminal?')) {
        await signOut();
      }
    });
  });
}

/**
 * Dynamically loads and initializes the page module.
 * @param {string} page
 * @param {object|null} context
 */
async function loadPageModule(page, context) {
  if (!page) return;
  try {
    const module = await import(`./pages/${page}.js?t=${Date.now()}`);
    if (module && typeof module.init === 'function') {
      await module.init(context);
    }
  } catch (err) {
    console.error(`Failed to load module js/pages/${page}.js:`, err);
  }
}

// Auto-run bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
