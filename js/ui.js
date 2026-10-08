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

  // Ensure modal is cleanly activated and unhidden
  modal.classList.remove('modal-closed');
  modal.classList.add('active');
  modal.style.display = 'flex';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';

  // Update hash safely without disruptive jumping
  if (window.location.hash !== `#${cleanId}`) {
    try {
      history.pushState(null, '', `#${cleanId}`);
    } catch (e) {
      window.location.hash = cleanId;
    }
  }

  // Focus the first input or close button
  setTimeout(() => {
    const focusable = modal.querySelector('input:not([type="hidden"]), select, textarea, button, a.modal-close-btn');
    if (focusable) focusable.focus();
  }, 50);
}

/**
 * Closes an active modal reliably across all browsers, removing both :target and inline/class states.
 * @param {string|HTMLElement|null} [targetModal] Optional specific modal ID or element to close
 */
export function closeModal(targetModal = null) {
  const modalsToClose = new Set();

  if (targetModal) {
    const el = typeof targetModal === 'string' ? document.getElementById(targetModal.replace(/^#/, '')) : targetModal;
    if (el) modalsToClose.add(el);
  }

  // Also locate currently targeted or active modals
  const currentHash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
  if (currentHash) {
    const targeted = document.getElementById(currentHash);
    if (targeted && targeted.classList.contains('modal-overlay')) {
      modalsToClose.add(targeted);
    }
  }

  document.querySelectorAll('.modal-overlay.active, .modal-overlay:target').forEach((m) => {
    modalsToClose.add(m);
  });

  // If no specific open modal was found, ensure all modal overlays are hidden
  if (modalsToClose.size === 0) {
    document.querySelectorAll('.modal-overlay').forEach((m) => modalsToClose.add(m));
  }

  modalsToClose.forEach((modal) => {
    modal.classList.remove('active');
    modal.classList.add('modal-closed');
    modal.style.display = 'none';
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
  });

  // Clear hash from address bar and un-target in CSS
  if (window.location.hash && window.location.hash !== '#') {
    try {
      history.pushState(null, '', window.location.pathname + window.location.search);
    } catch (e) {
      window.location.hash = '';
    }
  }

  if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

// Global modal event listeners for click-outside, close buttons, hash changes, and Escape key
if (typeof window !== 'undefined') {
  // 1. Click on backdrop or close button
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      closeModal(e.target);
      return;
    }
    const closeBtn = e.target.closest('[data-action*="close"], .modal-close-btn, a[href="#"], button[data-dismiss="modal"]');
    if (closeBtn && closeBtn.closest('.modal-overlay')) {
      e.preventDefault();
      closeModal(closeBtn.closest('.modal-overlay'));
    }
  });

  // 2. Escape key closes open modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const hasOpenModal = document.querySelector('.modal-overlay.active, .modal-overlay:target, .modal-overlay[style*="display: flex"]');
      if (hasOpenModal || window.location.hash) {
        closeModal();
      }
    }
  });

  // 3. React to hash changes (e.g. clicking <a href="#some-modal">)
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
    if (hash) {
      const modal = document.getElementById(hash);
      if (modal && modal.classList.contains('modal-overlay')) {
        modal.classList.remove('modal-closed');
        modal.classList.add('active');
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
      }
    }
  });
}

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
