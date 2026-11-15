// Import auth module
// Auth is available globally from auth.js (window.Auth)

async function initDashboard() {
  // Initialize authentication defensively
  if (typeof Auth !== 'undefined' && Auth && typeof Auth.initAuth === 'function') {
    try { await Auth.initAuth(); } catch (e) {}
  }

  // Safe fetch helper: works with token if present, falls back seamlessly to standard fetch
  async function safeFetch(url, options = {}) {
    let res = null;
    try {
      if (typeof Auth !== 'undefined' && Auth && typeof Auth.authenticatedFetch === 'function') {
        res = await Auth.authenticatedFetch(url, options);
        if (res && res.ok) return res;
      }
    } catch (e) {}

    const token = (typeof Auth !== 'undefined' && Auth && typeof Auth.getAccessToken === 'function') ? Auth.getAccessToken() : null;
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
      };
      const directRes = await fetch(url, { ...options, headers });
      if (directRes && directRes.ok) return directRes;
      if (directRes && directRes.status === 401 && token) {
        const cleanHeaders = {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        };
        const retryRes = await fetch(url, { ...options, headers: cleanHeaders });
        if (retryRes) return retryRes;
      }
      return directRes || res;
    } catch (e) {
      if (res) return res;
      throw e;
    }
  }

  // Stat elements
  const totalPatientsEl = document.getElementById('statTotalPatients') || document.getElementById('totalPatients');
  const todayAppointmentsEl = document.getElementById('statTodayAppointments') || document.getElementById('todayAppointments');
  const todayArrivalsEl = document.getElementById('statTodayArrivals') || document.getElementById('todayArrivals');
  const activeVisitsEl = document.getElementById('statActiveVisits') || document.getElementById('activeVisits');

  // Clock elements
  const dateEl = document.getElementById('currentDate');
  const timeEl = document.getElementById('currentTime');

  function updateClock() {
    const now = new Date();
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
      });
    }
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
  }

  updateClock();
  setInterval(updateClock, 1000);

  const activityBody = document.getElementById('dashboardActivityBody');

  async function fetchDashboardData() {
    try {
      const response = await safeFetch('/api/dashboard/stats');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const stats = await response.json();

      if (totalPatientsEl) totalPatientsEl.textContent = stats.totalPatients ?? 0;
      if (todayAppointmentsEl) todayAppointmentsEl.textContent = stats.todayAppointments ?? 0;
      if (todayArrivalsEl) todayArrivalsEl.textContent = stats.todayArrivals ?? 0;
      if (activeVisitsEl) activeVisitsEl.textContent = stats.activeVisits ?? 0;
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    }

    try {
      const response = await safeFetch('/api/appointments/today');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const list = await response.json();
      if (activityBody) {
        const arrivedList = list.filter(a => a.status === 'arrived');
        if (arrivedList.length === 0) {
          activityBody.innerHTML = `
            <tr class="empty-row">
              <td colspan="6" style="text-align: center; padding: 32px 16px; color: #64748B;">
                <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; background: rgba(0, 132, 255, 0.08); border: 1px solid rgba(0, 132, 255, 0.2); color: #0084FF; margin-bottom: 10px;">
                  <i class="fas fa-satellite-dish" style="font-size: 20px;"></i>
                </div>
                <div style="font-size: 14px; font-weight: 700; color: #1E293B;">No Patient Arrivals Logged Today</div>
                <div style="font-size: 12.5px; color: #64748B; margin-top: 4px;">When patients tap their physical NFC smart card at Reception, live arrivals appear here in real-time.</div>
              </td>
            </tr>
          `;
        } else {
          activityBody.innerHTML = arrivedList.map(a => `
            <tr class="table-capsule-row">
              <td><span class="arrival-time-cell"><span class="blue-dot"></span> ${a.arrived_at ? new Date(a.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (a.appointment_time || 'Walk-in')}</span></td>
              <td><strong>${a.first_name} ${a.last_name}</strong></td>
              <td><span class="nfc-chip-pill"><i class="fas fa-wifi" style="transform: rotate(90deg); font-size: 11px;"></i> ${a.card_uid || 'NFC'}</span></td>
              <td>${a.department || 'General'}</td>
              <td>${a.doctor_name || 'Attending Physician'}</td>
              <td><span class="status-pill status-arrived"><span class="green-dot"></span> Arrived &amp; Waiting</span></td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Failed to fetch arrivals for dashboard:', err);
    }
  }

  fetchDashboardData();
  setInterval(fetchDashboardData, 8000);

  // Sync when changes occur in other tabs
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('mediscan_')) {
      fetchDashboardData();
    }
  });
}

// Ensure execution whether DOM is already ready or loading
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}
