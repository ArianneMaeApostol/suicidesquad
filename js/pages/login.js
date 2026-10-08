/**
 * @file pages/login.js
 * Controller for login.html: authentication, inline error feedback, and role routing.
 */
import { signIn, getCurrentProfile, getHomeUrlForRole } from '../auth.js';
import { setStoredBranchId } from '../config.js';
import { setButtonLoading, escapeHTML, showToast } from '../ui.js';

export async function init() {
  const form = document.querySelector('form');
  const emailInput = document.getElementById('login-email') || form?.querySelector('input[type="email"]');
  const passwordInput = document.getElementById('login-password') || form?.querySelector('input[type="password"]');
  const submitBtn = form?.querySelector('button[type="submit"]');

  // Check URL query parameters for session expiration notices
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('message') === 'session_expired') {
    showInlineError(form, 'Your session has expired. Please log in again.', 'warning');
  }

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInlineError(form);

    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!email || !password) {
      showInlineError(form, 'Please enter both your email and password.', 'danger');
      return;
    }

    setButtonLoading(submitBtn, true, 'Signing in...');

    try {
      const { data, error } = await signIn(email, password);
      if (error) {
        showInlineError(form, error.message || 'Invalid operator credentials.', 'danger');
        setButtonLoading(submitBtn, false);
        return;
      }

      // Load user profile to determine correct destination
      const profile = await getCurrentProfile(true);
      if (!profile) {
        showInlineError(form, 'Account profile not found. Please contact the station owner.', 'danger');
        setButtonLoading(submitBtn, false);
        return;
      }

      // Store profile's assigned branch
      if (profile.branch_id) {
        setStoredBranchId(profile.branch_id);
      }

      if (!profile.is_active) {
        showInlineError(form, 'Your operator account has been deactivated.', 'danger');
        setButtonLoading(submitBtn, false);
        return;
      }

      // Check for redirect param
      const redirectUrl = urlParams.get('redirect');
      if (redirectUrl) {
        window.location.href = decodeURIComponent(redirectUrl);
        return;
      }

      // Default role landing page
      window.location.href = getHomeUrlForRole(profile.role);
    } catch (err) {
      showInlineError(form, 'An unexpected error occurred during sign in.', 'danger');
      setButtonLoading(submitBtn, false);
    }
  });
}

/**
 * Renders an inline alert box above the form inputs.
 * @param {HTMLFormElement} form
 * @param {string} message
 * @param {'danger'|'warning'|'info'} type
 */
function showInlineError(form, message, type = 'danger') {
  clearInlineError(form);
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type}`;
  alertDiv.id = 'login-inline-alert';
  alertDiv.style.marginBottom = '16px';
  alertDiv.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <div>${escapeHTML(message)}</div>
  `;
  form.prepend(alertDiv);
}

/**
 * Removes any active inline error alert.
 * @param {HTMLFormElement} form
 */
function clearInlineError(form) {
  const existing = form.querySelector('#login-inline-alert');
  if (existing) existing.remove();
}
