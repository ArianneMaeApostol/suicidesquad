/**
 * @file ui.js
 * Accessible UI components, toast notifications, modals, formatters, and helpers.
 */

/**
 * Escapes unsafe characters for safe inclusion in innerHTML.
 * @param {*} value
 * @returns {string}
 */
export function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats a number to Philippine Peso (₱).
 * @param {number|string} amount
 * @returns {string} e.g. "₱1,250.00"
 */
export function formatPHP(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * Formats an ISO date string to Asia/Manila date and time.
 * @param {string|Date} dateVal
 * @param {boolean} [includeTime=true]
 * @returns {string}
 */
export function formatDate(dateVal, includeTime = true) {
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);

  const options = {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  };

  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.hour12 = true;
  }

  return new Intl.DateTimeFormat('en-PH', options).format(d);
}

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Displays an accessible, non-blocking toast alert.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'danger'} [type='info']
 * @param {number} [duration=3500]
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    container.style.maxWidth = '380px';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `alert alert-${type}`;
  toast.style.margin = '0';
  toast.style.boxShadow = 'var(--shadow-lg)';
  toast.style.pointerEvents = 'auto';
  toast.style.animation = 'fadeIn 200ms ease';
  toast.innerHTML = `
    <div style="flex: 1; font-weight: 500;">${escapeHTML(message)}</div>
    <button type="button" style="background: none; border: none; font-size: 1.1rem; line-height: 1; cursor: pointer; color: inherit; padding: 0 4px;" aria-label="Close notification">&times;</button>
  `;

  const closeBtn = toast.querySelector('button');
  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease';
    setTimeout(() => toast.remove(), 200);
  };

  closeBtn.addEventListener('click', removeToast);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
}

/**
 * Opens a modal element by ID, managing focus and hash navigation.
 * @param {string} modalId
 */
let previouslyFocusedElement = null;

export function openModal(modalId) {
  const cleanId = modalId.replace(/^#/, '');
  const modal = document.getElementById(cleanId);
  if (!modal) return;

  previouslyFocusedElement = document.activeElement;
  window.location.hash = cleanId;

  // Focus the first input or close button
  setTimeout(() => {
    const focusable = modal.querySelector('input, select, textarea, button, a.modal-close-btn');
    if (focusable) focusable.focus();
  }, 50);
}

/**
 * Closes an active modal without altering scroll position.
 */
export function closeModal() {
  if (window.location.hash) {
    history.pushState('', document.title, window.location.pathname + window.location.search);
  }
  if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

// Global Escape key listener to close modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.location.hash) {
    closeModal();
  }
});

/**
 * Sets a button in loading state with a spinner or text.
 * @param {HTMLButtonElement|null} button
 * @param {boolean} isLoading
 * @param {string} [loadingText='Processing...']
 */
export function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
      </svg>
      <span>${escapeHTML(loadingText)}</span>
    `;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

/**
 * Renders animated skeleton placeholder rows.
 * @param {HTMLElement} container
 * @param {number} [rows=3]
 */
export function renderSkeleton(container, rows = 3) {
  if (!container) return;
  let html = '<div style="display: flex; flex-direction: column; gap: 12px; width: 100%; padding: 12px 0;">';
  for (let i = 0; i < rows; i++) {
    html += `
      <div style="display: flex; gap: 12px; align-items: center;">
        <div class="skeleton" style="width: 36px; height: 36px; border-radius: var(--radius-md);"></div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
          <div class="skeleton" style="height: 14px; width: 60%;"></div>
          <div class="skeleton" style="height: 10px; width: 40%;"></div>
        </div>
        <div class="skeleton" style="height: 16px; width: 60px;"></div>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Renders an empty state view with icon and action.
 * @param {HTMLElement} container
 * @param {string} title
 * @param {string} subtitle
 * @param {string} [actionHtml='']
 */
export function renderEmptyState(container, title, subtitle, actionHtml = '') {
  if (!container) return;
  container.innerHTML = `
    <div style="text-align: center; padding: 48px 24px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <div style="width: 56px; height: 56px; border-radius: 50%; background-color: var(--bg-surface-alt); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; color: var(--text-subtle);">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
      </div>
      <div style="font-weight: 700; color: var(--text-main); font-size: 1rem; margin-bottom: 4px;">${escapeHTML(title)}</div>
      <div style="font-size: 0.85rem; max-width: 320px; margin-bottom: 16px;">${escapeHTML(subtitle)}</div>
      ${actionHtml}
    </div>
  `;
}
