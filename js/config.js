/**
 * @file config.js
 * FastAPI backend configuration, endpoint base URL, and local storage tokens.
 */

// Base URL for Python FastAPI server (supports cloud backend or localhost)
export const API_BASE_URL =
  window.__API_BASE_URL__ ||
  localStorage.getItem('wrsms_api_url') ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'http://localhost:8000');

export const TOKEN_STORAGE_KEY = 'wrsms_token';
export const USER_STORAGE_KEY = 'wrsms_user';
export const ACTIVE_BRANCH_STORAGE_KEY = 'wrsms_active_branch_id';

/**
 * Retrieves the JWT access token from localStorage.
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || null;
}

/**
 * Persists the JWT access token in localStorage.
 * @param {string} token
 */
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

/**
 * Clears the stored JWT access token.
 */
export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Retrieves cached user object from localStorage.
 * @returns {object|null}
 */
export function getStoredUser() {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Caches the current authenticated user object.
 * @param {object} user
 */
export function setStoredUser(user) {
  if (user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_STORAGE_KEY);
  }
}

/**
 * Clears cached user object.
 */
export function clearStoredUser() {
  localStorage.removeItem(USER_STORAGE_KEY);
}

/**
 * Retrieves the active branch ID for multi-branch switching (Owner role).
 * @returns {string|null}
 */
export function getStoredBranchId() {
  return localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY) || null;
}

/**
 * Sets the active branch ID in localStorage.
 * @param {string} branchId
 */
export function setStoredBranchId(branchId) {
  if (branchId) {
    localStorage.setItem(ACTIVE_BRANCH_STORAGE_KEY, branchId);
  } else {
    localStorage.removeItem(ACTIVE_BRANCH_STORAGE_KEY);
  }
}
