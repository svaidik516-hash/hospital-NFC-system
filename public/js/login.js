/**
 * MediScan NFC - Login Page Script
 * Handles user authentication with the API client
 */

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail') || document.getElementById('email');
  const loginPassword = document.getElementById('loginPassword') || document.getElementById('password');
  const btnLogin = document.getElementById('btnLogin');
  const togglePassword = document.getElementById('togglePassword');

  // Toggle password visibility
  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const icon = togglePassword.querySelector('i');
      if (loginPassword.type === 'password') {
        loginPassword.type = 'text';
        icon.className = 'fas fa-eye-slash';
      } else {
        loginPassword.type = 'password';
        icon.className = 'fas fa-eye';
      }
    });
  }

  // Check if already logged in
  if (api && api.user) {
    window.location.href = 'index.html';
    return;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = loginEmail.value.trim();
      const password = loginPassword.value;

      if (!email || !password) {
        showToast('Please enter your email and password', 'error');
        return;
      }

      // Disable submit button
      btnLogin.disabled = true;
      btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';

      try {
        const result = await api.login(email, password);

        showToast(`Welcome, ${result.user.name}!`, 'success');

        // Redirect based on role
        const redirectMap = {
          admin: 'admin.html',
          doctor: 'doctor.html',
          reception: 'reception.html',
        };

        const redirect = redirectMap[result.user.role] || 'index.html';
        setTimeout(() => {
          window.location.href = redirect;
        }, 800);
      } catch (err) {
        showToast(err.message || 'Login failed', 'error');
        btnLogin.disabled = false;
        btnLogin.innerHTML = '<i class="fas fa-sign-in-alt"></i> Access System';
      }
    });
  }

  // Toast notification helper
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> <span>${message}</span>`;
    Object.assign(toast.style, {
      position: 'fixed',
      top: '24px',
      right: '24px',
      padding: '14px 22px',
      borderRadius: '10px',
      color: '#fff',
      zIndex: '99999',
      fontSize: '15px',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      transition: 'all 0.3s ease',
      backgroundColor: type === 'success' ? '#06D6A0' : type === 'error' ? '#EF476F' : '#0077B6'
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
});