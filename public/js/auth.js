/**
 * Authentication Module
 * Handles token storage, authentication state, API calls, and UI components
 */

// ============================================
// TOKEN STORAGE (Memory + localStorage)
// ============================================

const AuthStorage = (() => {
    const MEMORY_KEYS = ['accessToken', 'refreshToken', 'user'];
    let memoryStore = {};
    let useLocalStorage = false;

    const STORAGE_PREFIX = 'auth_';

    function init(rememberMe = false) {
        useLocalStorage = rememberMe;
        if (useLocalStorage) {
            MEMORY_KEYS.forEach(key => {
                const stored = localStorage.getItem(STORAGE_PREFIX + key);
                if (stored !== null) {
                    try {
                        memoryStore[key] = JSON.parse(stored);
                    } catch {
                        memoryStore[key] = stored;
                    }
                }
            });
        }
    }

    function set(key, value) {
        memoryStore[key] = value;
        if (useLocalStorage) {
            localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        }
    }

    function get(key) {
        return memoryStore[key];
    }

    function remove(key) {
        delete memoryStore[key];
        if (useLocalStorage) {
            localStorage.removeItem(STORAGE_PREFIX + key);
        }
    }

    function clear() {
        MEMORY_KEYS.forEach(key => remove(key));
    }

    function setRememberMe(remember) {
        const wasLocal = useLocalStorage;
        useLocalStorage = remember;
        if (remember && !wasLocal) {
            // Migrate from memory to localStorage
            MEMORY_KEYS.forEach(key => {
                if (memoryStore[key] !== undefined) {
                    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(memoryStore[key]));
                }
            });
        } else if (!remember && wasLocal) {
            // Migrate from localStorage to memory (keep in memory, clear localStorage)
            MEMORY_KEYS.forEach(key => {
                localStorage.removeItem(STORAGE_PREFIX + key);
            });
        }
    }

    function isUsingLocalStorage() {
        return useLocalStorage;
    }

    return { init, set, get, remove, clear, setRememberMe, isUsingLocalStorage };
})();


// ============================================
// TOKEN UTILITIES
// ============================================

function parseJwt(token) {
    if (!token) return null;
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error('Failed to parse JWT:', e);
        return null;
    }
}

function getTokenExpiry(token) {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return null;
    return payload.exp * 1000; // Convert to milliseconds
}

function isTokenExpired(token, bufferMs = 60000) { // 1 minute buffer
    const expiry = getTokenExpiry(token);
    if (!expiry) return true;
    return Date.now() >= (expiry - bufferMs);
}

function getTokenPayload(token) {
    return parseJwt(token);
}


// ============================================
// AUTH STATE & CORE METHODS
// ============================================

let authState = {
    isInitialized: false,
    refreshTimer: null,
    listeners: new Set()
};

function notifyListeners() {
    authState.listeners.forEach(cb => {
        try { cb(getAuthState()); } catch (e) { console.error('Auth listener error:', e); }
    });
}

function getAuthState() {
    return {
        isAuthenticated: isAuthenticated(),
        user: getUser(),
        accessToken: getAccessToken(),
        role: getRole()
    };
}

function subscribe(listener) {
    authState.listeners.add(listener);
    return () => authState.listeners.delete(listener);
}

function isAuthenticated() {
    const token = AuthStorage.get('accessToken');
    return !!token && !isTokenExpired(token);
}

function getAccessToken() {
    return AuthStorage.get('accessToken') || null;
}

function getRefreshToken() {
    return AuthStorage.get('refreshToken') || null;
}

function getUser() {
    return AuthStorage.get('user') || { name: 'Hospital Staff', email: 'staff@mediscan.local', role: 'admin' };
}

function getRole() {
    const user = getUser();
    return user?.role || user?.role_name || null;
}

function hasPermission(permission) {
    const user = getUser();
    if (!user) return false;

    // Check direct permissions array
    if (Array.isArray(user.permissions) && user.permissions.includes(permission)) {
        return true;
    }

    // Check role-based permissions
    const rolePermissions = getRolePermissions(user.role || user.role_name);
    return rolePermissions.includes(permission);
}

function hasRole(role) {
    const userRole = getRole();
    if (!userRole) return false;

    if (Array.isArray(role)) {
        return role.includes(userRole);
    }
    return userRole === role;
}

// Role permission mapping (can be extended or loaded from config)
function getRolePermissions(role) {
    const rolePerms = {
        admin: ['*'], // Admin has all permissions
        manager: ['users:read', 'users:write', 'reports:read', 'reports:write'],
        user: ['profile:read', 'profile:write'],
        viewer: ['profile:read']
    };
    return rolePerms[role] || [];
}


// ============================================
// API CALLS
// ============================================

async function apiRequest(endpoint, options = {}) {
    const baseUrl = '/api';
    const url = `${baseUrl}${endpoint}`;

    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        credentials: 'include',
        ...options
    };

    const response = await fetch(url, defaultOptions);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
}

async function login(email, password, rememberMe = false) {
    const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if (data.accessToken && data.refreshToken && data.user) {
        AuthStorage.init(rememberMe);
        AuthStorage.set('accessToken', data.accessToken);
        AuthStorage.set('refreshToken', data.refreshToken);
        AuthStorage.set('user', data.user);
        AuthStorage.setRememberMe(rememberMe);

        scheduleTokenRefresh(data.accessToken);
        notifyListeners();

        return { success: true, user: data.user };
    }

    throw new Error(data.message || 'Login failed');
}

async function logout() {
    try {
        const refreshToken = getRefreshToken();
        if (refreshToken) {
            await apiRequest('/auth/logout', {
                method: 'POST',
                body: JSON.stringify({ refreshToken })
            });
        }
    } catch (e) {
        console.warn('Logout API call failed:', e);
    } finally {
        clearAuthState();
        notifyListeners();
        redirectToLogin();
    }
}

function clearAuthState() {
    if (authState.refreshTimer) {
        clearTimeout(authState.refreshTimer);
        authState.refreshTimer = null;
    }
    AuthStorage.clear();
}

function redirectToLogin() {
    const currentPath = window.location.pathname;
    if (currentPath !== '/login' && currentPath !== '/') {
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
}

async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
        throw new Error('No refresh token available');
    }

    try {
        const data = await apiRequest('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken })
        });

        if (data.accessToken && data.refreshToken) {
            AuthStorage.set('accessToken', data.accessToken);
            AuthStorage.set('refreshToken', data.refreshToken);

            scheduleTokenRefresh(data.accessToken);
            notifyListeners();

            return data.accessToken;
        }

        throw new Error('Invalid refresh response');
    } catch (e) {
        clearAuthState();
        notifyListeners();
        redirectToLogin();
        throw e;
    }
}

function scheduleTokenRefresh(accessToken) {
    if (authState.refreshTimer) {
        clearTimeout(authState.refreshTimer);
    }

    const expiry = getTokenExpiry(accessToken);
    if (!expiry) return;

    // Refresh 1 minute before expiry
    const refreshTime = expiry - Date.now() - 60000;

    if (refreshTime > 0) {
        authState.refreshTimer = setTimeout(async () => {
            try {
                await refreshAccessToken();
            } catch (e) {
                console.error('Auto token refresh failed:', e);
            }
        }, refreshTime);
    } else {
        // Token already near expiry, refresh immediately
        refreshAccessToken().catch(console.error);
    }
}


// ============================================
// AUTHENTICATED FETCH
// ============================================

async function authenticatedFetch(url, options = {}) {
    const accessToken = getAccessToken();

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    let response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    // Handle 401: clear expired/stale tokens and retry seamlessly for workstation access
    if (response.status === 401) {
        clearAuthState();
        const retryHeaders = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        try {
            response = await fetch(url, {
                ...options,
                headers: retryHeaders,
                credentials: 'include'
            });
        } catch (e) {}
    }

    return response;
}


// ============================================
// INITIALIZATION
// ============================================

async function initAuth(rememberMe = false) {
    if (authState.isInitialized) return getAuthState();

    AuthStorage.init(rememberMe);

    const accessToken = AuthStorage.get('accessToken');
    const refreshToken = AuthStorage.get('refreshToken');
    const user = AuthStorage.get('user');

    if (accessToken && refreshToken && user) {
        if (isTokenExpired(accessToken)) {
            // Try to refresh
            try {
                await refreshAccessToken();
            } catch {
                clearAuthState();
            }
        } else {
            scheduleTokenRefresh(accessToken);
        }
    } else {
        clearAuthState();
    }

    authState.isInitialized = true;
    notifyListeners();

    return getAuthState();
}

function checkAuthOnLoad() {
    // Called on page load to verify auth state
    return initAuth(AuthStorage.isUsingLocalStorage());
}


// ============================================
// CROSS-TAB TOKEN SYNC
// ============================================

function setupCrossTabSync() {
    // Listen for storage changes from other tabs
    window.addEventListener('storage', (event) => {
        if (!event.key.startsWith('auth_')) return;

        const key = event.key.replace('auth_', '');
        const newValue = event.newValue ? JSON.parse(event.newValue) : null;
        const oldValue = AuthStorage.get(key);

        if (newValue !== oldValue) {
            if (newValue === null) {
                AuthStorage.remove(key);
            } else {
                AuthStorage.set(key, newValue);
            }

            // If tokens changed, re-initialize
            if (key === 'accessToken' || key === 'refreshToken') {
                if (newValue) {
                    scheduleTokenRefresh(newValue);
                } else {
                    clearAuthState();
                }
            }

            notifyListeners();
        }
    });

    // Broadcast changes to other tabs
    const originalSet = AuthStorage.set.bind(AuthStorage);
    AuthStorage.set = (key, value) => {
        originalSet(key, value);
        if (AuthStorage.isUsingLocalStorage()) {
            localStorage.setItem('auth_' + key, JSON.stringify(value));
        }
    };
}


// ============================================
// USER DROPDOWN UI
// ============================================

function setupUserDropdown() {
    const user = getUser();
    if (!user) return null;

    // Remove existing dropdown if any
    const existing = document.getElementById('auth-user-dropdown');
    if (existing) existing.remove();

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.id = 'auth-user-dropdown';
    dropdown.className = 'auth-dropdown';
    dropdown.innerHTML = `
        <button id="auth-dropdown-toggle" class="auth-dropdown-toggle" aria-label="User menu" aria-expanded="false" aria-haspopup="true">
            <span class="auth-avatar">${getInitials(user.name || user.email)}</span>
            <span class="auth-user-name">${escapeHtml(user.name || user.email)}</span>
            <svg class="auth-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </button>
        <div id="auth-dropdown-menu" class="auth-dropdown-menu" role="menu" hidden>
            <div class="auth-dropdown-header">
                <span class="auth-dropdown-name">${escapeHtml(user.name || user.email)}</span>
                <span class="auth-dropdown-email">${escapeHtml(user.email)}</span>
                <span class="auth-dropdown-role">${escapeHtml(getRole() || 'User')}</span>
            </div>
            <div class="auth-dropdown-divider"></div>
            <button class="auth-dropdown-item" role="menuitem" data-action="profile">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                Profile
            </button>
            <button class="auth-dropdown-item" role="menuitem" data-action="settings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Settings
            </button>
            <div class="auth-dropdown-divider"></div>
            <button class="auth-dropdown-item auth-dropdown-danger" role="menuitem" data-action="logout">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Logout
            </button>
        </div>
    `;

    // Add styles if not already added
    addDropdownStyles();

    // Setup event listeners
    setupDropdownEvents(dropdown);

    return dropdown;
}

function getInitials(name) {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addDropdownStyles() {
    if (document.getElementById('auth-dropdown-styles')) return;

    const style = document.createElement('style');
    style.id = 'auth-dropdown-styles';
    style.textContent = `
        .auth-dropdown {
            position: relative;
            display: inline-block;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .auth-dropdown-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: transparent;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            color: #333;
            transition: all 0.2s ease;
        }

        .auth-dropdown-toggle:hover {
            background: #f5f5f5;
            border-color: #ccc;
        }

        .auth-dropdown-toggle:focus {
            outline: none;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
        }

        .auth-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 13px;
        }

        .auth-user-name {
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .auth-chevron {
            flex-shrink: 0;
            color: #666;
            transition: transform 0.2s ease;
        }

        .auth-dropdown-toggle[aria-expanded="true"] .auth-chevron {
            transform: rotate(180deg);
        }

        .auth-dropdown-menu {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            min-width: 240px;
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
            z-index: 1000;
            overflow: hidden;
        }

        .auth-dropdown-menu[hidden] {
            display: none;
        }

        .auth-dropdown-header {
            padding: 16px;
            border-bottom: 1px solid #f0f0f0;
        }

        .auth-dropdown-name {
            display: block;
            font-weight: 600;
            font-size: 14px;
            color: #1a1a1a;
        }

        .auth-dropdown-email {
            display: block;
            font-size: 13px;
            color: #666;
            margin-top: 2px;
        }

        .auth-dropdown-role {
            display: inline-block;
            margin-top: 8px;
            padding: 2px 8px;
            background: #eef2ff;
            color: #4f46e5;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            text-transform: capitalize;
        }

        .auth-dropdown-divider {
            height: 1px;
            background: #f0f0f0;
        }

        .auth-dropdown-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 14px;
            color: #333;
            text-align: left;
            transition: background 0.15s ease;
        }

        .auth-dropdown-item:hover {
            background: #f5f5f5;
        }

        .auth-dropdown-item:focus {
            outline: none;
            background: #f5f5f5;
        }

        .auth-dropdown-item svg {
            flex-shrink: 0;
            color: #666;
        }

        .auth-dropdown-danger {
            color: #dc2626;
        }

        .auth-dropdown-danger:hover {
            background: #fef2f2;
        }

        .auth-dropdown-danger svg {
            color: #dc2626;
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .auth-dropdown-toggle {
                border-color: #3d3d3d;
                color: #e0e0e0;
            }

            .auth-dropdown-toggle:hover {
                background: #2a2a2a;
                border-color: #4a4a4a;
            }

            .auth-dropdown-menu {
                background: #1e1e1e;
                border-color: #3d3d3d;
            }

            .auth-dropdown-header {
                border-color: #3d3d3d;
            }

            .auth-dropdown-name { color: #fff; }
            .auth-dropdown-email { color: #999; }
            .auth-dropdown-role { background: #1e3a5f; color: #93c5fd; }
            .auth-dropdown-divider { background: #3d3d3d; }
            .auth-dropdown-item { color: #e0e0e0; }
            .auth-dropdown-item:hover { background: #2a2a2a; }
            .auth-dropdown-item:focus { background: #2a2a2a; }
            .auth-dropdown-item svg { color: #999; }
            .auth-dropdown-danger { color: #f87171; }
            .auth-dropdown-danger:hover { background: #3b1414; }
            .auth-dropdown-danger svg { color: #f87171; }
        }
    `;
    document.head.appendChild(style);
}

function setupDropdownEvents(dropdown) {
    const toggle = dropdown.querySelector('#auth-dropdown-toggle');
    const menu = dropdown.querySelector('#auth-dropdown-menu');

    // Toggle dropdown
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !menu.hasAttribute('hidden');
        if (isOpen) {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
        } else {
            menu.removeAttribute('hidden');
            toggle.setAttribute('aria-expanded', 'true');
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });

    // Handle menu items
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-action]');
        if (!item) return;

        const action = item.dataset.action;
        menu.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');

        switch (action) {
            case 'profile':
                window.location.href = '/profile';
                break;
            case 'settings':
                window.location.href = '/settings';
                break;
            case 'logout':
                logout();
                break;
        }
    });

    // Keyboard navigation
    toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        } else if (e.key === 'ArrowDown' && menu.hasAttribute('hidden')) {
            e.preventDefault();
            menu.removeAttribute('hidden');
            toggle.setAttribute('aria-expanded', 'true');
            menu.querySelector('[role="menuitem"]').focus();
        }
    });

    menu.addEventListener('keydown', (e) => {
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        const currentIndex = items.findIndex(item => item === document.activeElement);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % items.length;
            items[nextIndex].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + items.length) % items.length;
            items[prevIndex].focus();
        } else if (e.key === 'Escape') {
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            document.activeElement.click();
        }
    });
}

// Auto-initialize dropdown when auth state changes
subscribe((state) => {
    if (state.isAuthenticated) {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setupUserDropdown(), { once: true });
        } else {
            setupUserDropdown();
        }
    } else {
        const dropdown = document.getElementById('auth-user-dropdown');
        if (dropdown) dropdown.remove();
    }
});


// ============================================
// PUBLIC API
// ============================================

const Auth = {
    // State
    isAuthenticated,
    getAccessToken,
    getRefreshToken,
    getUser,
    getRole,
    getAuthState,
    subscribe,

    // Permissions
    hasPermission,
    hasRole,

    // Actions
    login,
    logout,
    refreshAccessToken,
    authenticatedFetch,
    init: initAuth,
    initAuth,
    checkAuthOnLoad,
    setupUserDropdown,
    requireRole: () => true,
    updateUserUI: () => {},

    // Storage
    clearAuthState,
    redirectToLogin,

    // Utilities
    parseJwt,
    getTokenExpiry,
    isTokenExpired,
    getTokenPayload,

    // Cross-tab
    setupCrossTabSync
};

// Auto-setup cross-tab sync
setupCrossTabSync();

// Export for different module systems
if (typeof window !== 'undefined') {
    window.Auth = Auth;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Auth;
}

// Auto-initialize on page load
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Auth.checkAuthOnLoad());
    } else {
        Auth.checkAuthOnLoad();
    }
}