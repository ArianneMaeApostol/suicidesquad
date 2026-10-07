/**
 * @file auth.js
 * Session management, JWT auth guards, and role-based permissions using Python FastAPI backend.
 */
import {
  API_BASE_URL,
  getToken,
  setToken,
  clearToken,
  getStoredUser,
  setStoredUser,
  clearStoredUser
} from './config.js';

let cachedProfile = null;

/**
 * Sign in with email and password via FastAPI backend.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function signIn(email, password) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Invalid email or password');
    }

    setToken(data.token);
    setStoredUser(data.user);
    cachedProfile = data.user;

    return {
      data: {
        session: { access_token: data.token, user: data.user },
        user: data.user
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Sign out current user and clear local session.
 * @returns {Promise<void>}
 */
export async function signOut() {
  cachedProfile = null;
  clearToken();
  clearStoredUser();
  window.location.href = 'login.html';
}

/**
 * Get current active session.
 * @returns {Promise<object|null>}
 */
export async function getSession() {
  const token = getToken();
  if (!token) return null;
  const user = getStoredUser();
  return { access_token: token, user };
}

/**
 * Fetch and cache the profile of the authenticated user.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<{ id: string, branch_id: string|null, full_name: string, role: string, is_active: boolean }|null>}
 */
export async function getCurrentProfile(forceRefresh = false) {
  if (cachedProfile && !forceRefresh) {
    return cachedProfile;
  }

  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        clearStoredUser();
      }
      return null;
    }

    const user = await res.json();
    cachedProfile = user;
    setStoredUser(user);
    return cachedProfile;
  } catch (err) {
    console.warn('Unable to verify user profile from backend, falling back to local cache:', err);
    return getStoredUser();
  }
}

/**
 * Determine default landing page by user role.
 * Riders land on deliveries.html, others land on dashboard.html.
 * @param {string} role
 * @returns {string}
 */
export function getHomeUrlForRole(role) {
  if (role === 'rider') {
    return 'deliveries.html';
  }
  return 'dashboard.html';
}

/**
 * Guard page access: enforces active session and role-based permissions.
 * Redirects to login.html if unauthenticated or inactive.
 * @param {string[]} [allowedRoles=[]] Optional array of allowed roles.
 * @returns {Promise<{ profile: object, session: object }|null>}
 */
export async function requireAuth(allowedRoles = []) {
  const session = await getSession();
  if (!session) {
    const current = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `login.html?redirect=${current}`;
    return null;
  }

  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    alert('Your account is currently inactive or profile is not found. Please contact the station owner.');
    await signOut();
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    const home = getHomeUrlForRole(profile.role);
    window.location.href = home;
    return null;
  }

  return { profile, session };
}

/**
 * Listen for auth state changes (e.g. cross-tab signout).
 * @param {Function} callback
 */
export function setupAuthListener(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === 'wrsms_token' && !e.newValue) {
      cachedProfile = null;
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html?message=session_expired';
      }
    }
  });
}
