/**
 * MediScan NFC - Centralized API Client
 * Handles all backend communication with authentication, error handling, and retries
 */

class ApiClient {
  constructor() {
    this.baseUrl = '/api';
    this.token = null;
    this.refreshToken = null;
    this.isRefreshing = false;
    this.failedQueue = [];

    // Load token from localStorage if available
    this.loadToken();
  }

  loadToken() {
    const stored = localStorage.getItem('mediscan_auth');
    if (stored) {
      try {
        const auth = JSON.parse(stored);
        this.token = auth.token;
        this.refreshToken = auth.refreshToken;
        this.user = auth.user;
      } catch (e) {
        localStorage.removeItem('mediscan_auth');
      }
    }
  }

  saveToken(auth) {
    this.token = auth.token;
    this.refreshToken = auth.refreshToken;
    this.user = auth.user;
    localStorage.setItem('mediscan_auth', JSON.stringify(auth));
  }

  clearToken() {
    this.token = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem('mediscan_auth');
  }

  getHeaders(includeAuth = true) {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (includeAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      headers: this.getHeaders(options.auth !== false),
      ...options,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      let response = await fetch(url, config);

      // Handle 401 - token expired, try refresh
      if (response.status === 401 && this.refreshToken && !options._retry) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          config.headers = this.getHeaders(options.auth !== false);
          response = await fetch(url, config);
        } else {
          this.handleAuthFailure();
          throw new Error('Session expired. Please log in again.');
        }
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection.');
      }
      throw err;
    }
  }

  async refreshAccessToken() {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) throw new Error('Refresh failed');

      const data = await response.json();
      this.saveToken(data);

      this.failedQueue.forEach(({ resolve }) => resolve(true));
      this.failedQueue = [];
      this.isRefreshing = false;
      return true;
    } catch (err) {
      this.failedQueue.forEach(({ reject }) => reject(err));
      this.failedQueue = [];
      this.isRefreshing = false;
      return false;
    }
  }

  handleAuthFailure() {
    this.clearToken();
    // Redirect to login if not already there
    if (!window.location.pathname.includes('login.html')) {
      window.location.href = 'login.html';
    }
  }

  // ─── Auth Endpoints ──────────────────────────────────────────────

  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    this.saveToken(data);
    return data;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearToken();
    }
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  // ─── Patient Endpoints ───────────────────────────────────────────

  async getPatients() {
    return this.request('/patients');
  }

  async getPatientByCardUID(cardUID) {
    return this.request(`/patients/card/${encodeURIComponent(cardUID)}`);
  }

  async createPatient(data) {
    return this.request('/patients', {
      method: 'POST',
      body: data,
    });
  }

  async updatePatient(id, data) {
    return this.request(`/patients/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deletePatient(id) {
    return this.request(`/patients/${id}`, {
      method: 'DELETE',
    });
  }

  async searchPatients(query) {
    return this.request(`/patients/search?q=${encodeURIComponent(query)}`);
  }

  // ─── Visit Endpoints ─────────────────────────────────────────────

  async createVisit(data) {
    return this.request('/visits', {
      method: 'POST',
      body: data,
    });
  }

  async updateVisit(id, data) {
    return this.request(`/visits/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async getVisitsByPatient(patientId) {
    return this.request(`/visits/patient/${patientId}`);
  }

  // ─── Prescription Endpoints ──────────────────────────────────────

  async createPrescription(data) {
    return this.request('/prescriptions', {
      method: 'POST',
      body: data,
    });
  }

  async getPrescriptionsByPatient(patientId) {
    return this.request(`/prescriptions/patient/${patientId}`);
  }

  async getPrescriptionsByVisit(visitId) {
    return this.request(`/prescriptions/visit/${visitId}`);
  }

  // ─── Appointment Endpoints ───────────────────────────────────────

  async createAppointment(data) {
    return this.request('/appointments', {
      method: 'POST',
      body: data,
    });
  }

  async getTodayAppointments() {
    return this.request('/appointments/today');
  }

  async getAppointmentsByDate(date) {
    return this.request(`/appointments/date/${date}`);
  }

  async updateAppointment(id, data) {
    return this.request(`/appointments/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  // ─── Check-in Endpoint ───────────────────────────────────────────

  async checkIn(cardUID) {
    return this.request('/checkin', {
      method: 'POST',
      body: { card_uid: cardUID },
    });
  }

  // ─── Lab Report Endpoints ────────────────────────────────────────

  async createLabReport(data) {
    return this.request('/lab-reports', {
      method: 'POST',
      body: data,
    });
  }

  async getLabReportsByPatient(patientId) {
    return this.request(`/lab-reports/patient/${patientId}`);
  }

  // ─── Doctor Endpoints ────────────────────────────────────────────

  async getDoctors() {
    return this.request('/doctors');
  }

  async createDoctor(data) {
    return this.request('/doctors', {
      method: 'POST',
      body: data,
    });
  }

  // ─── Follow-up & Notifications ───────────────────────────────────

  async sendFollowupAndNotify(data) {
    return this.request('/doctor/followup-and-notify', {
      method: 'POST',
      body: data,
    });
  }

  async getNotificationHistory(patientId) {
    return this.request(`/notifications/patient/${patientId}`);
  }

  async viewEmailNotification(id) {
    const response = await fetch(`${this.baseUrl}/notifications/view-email/${id}`, {
      headers: this.getHeaders(),
    });
    return response.text();
  }

  async downloadVisitPDF(visitId) {
    const response = await fetch(`${this.baseUrl}/visits/${visitId}/pdf`, {
      headers: this.getHeaders(),
    });
    return response.blob();
  }

  // ─── Dashboard ───────────────────────────────────────────────────

  async getDashboardStats() {
    return this.request('/dashboard/stats');
  }

  // ─── Admin Only Endpoints ────────────────────────────────────────

  async getAdminStats() {
    return this.request('/admin/stats');
  }

  async getAuditLogs(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/admin/audit-logs?${query}`);
  }

  async exportPatientData(cardUID) {
    return this.request(`/admin/export-patient/${encodeURIComponent(cardUID)}`);
  }
}

// Singleton instance
const api = new ApiClient();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ApiClient, api };
} else {
  window.api = api;
  window.ApiClient = ApiClient;
}