// Import auth module
// Auth is available globally from auth.js (window.Auth)

async function initReception() {
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

  // ── Utility Toast ──────────────────────────────────────────────────
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

  // ── DOM References ────────────────────────────────────────────────
  const nfcScanArea = document.getElementById('nfcScanArea');
  const cardInput = document.getElementById('cardUIDInput') || document.getElementById('cardInput');
  const checkInBtn = document.getElementById('btnCheckIn') || document.getElementById('checkInBtn');
  const patientInfoPanel = document.getElementById('patientInfoPanel');
  const allergyBanner = document.getElementById('allergyBanner');
  const allergyText = document.getElementById('allergyText');
  const patientNameEl = document.getElementById('patientName');
  const checkInStatusEl = document.getElementById('checkInStatus');
  const patientAgeEl = document.getElementById('patientAge');
  const patientGenderEl = document.getElementById('patientGender');
  const patientBloodEl = document.getElementById('patientBloodGroup');
  const patientPhoneEl = document.getElementById('patientPhone');
  const patientEmergencyEl = document.getElementById('patientEmergency');
  const appointmentInfoEl = document.getElementById('appointmentInfo');
  const queueCountEl = document.getElementById('queueCount');
  const queueTableBody = document.getElementById('queueTableBody');

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

  // Focus card input automatically for USB hardware scanners
  if (cardInput) {
    cardInput.focus();
  }

  // Audio chime feedback using Web Audio API
  function playBeep(success = true) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (success) {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch (e) { }
  }

  let autoResetTimer = null;

  // ── Web NFC API Integration (For physical NFC phones / hardware readers) ──
  async function setupWebNFC() {
    if ('NDEFReader' in window) {
      try {
        const ndef = new NDEFReader();
        await ndef.scan();
        ndef.addEventListener('reading', ({ serialNumber }) => {
          console.log(`NFC Tag detected: ${serialNumber}`);
          const formattedUID = serialNumber ? serialNumber.replace(/:/g, '').toUpperCase() : '';
          handleCardScan(formattedUID);
        });
        showToast('NFC reader active! Tap patient card on device.', 'info');
      } catch (err) {
        console.info('Web NFC not started (requires HTTPS & mobile Chrome):', err.message);
      }
    }
  }
  setupWebNFC();

  // ── Manual & Simulated Trigger ─────────────────────────────────────
  if (checkInBtn) {
    checkInBtn.addEventListener('click', () => {
      const uid = cardInput?.value.trim();
      if (!uid) {
        showToast('Please tap a card or enter a Card UID', 'error');
        return;
      }
      handleCardScan(uid);
    });
  }

  if (cardInput) {
    cardInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        checkInBtn?.click();
      }
    });
  }

  // ── Main Card Scan Handler ─────────────────────────────────────────
  async function handleCardScan(uid) {
    if (autoResetTimer) {
      clearTimeout(autoResetTimer);
      autoResetTimer = null;
    }

    if (nfcScanArea) {
      nfcScanArea.classList.remove('success', 'error');
      nfcScanArea.classList.add('scanning');
    }

    try {
      const response = await safeFetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_uid: uid })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Check-in failed' }));
        throw new Error(error.message || 'Check-in failed');
      }

      if (nfcScanArea) {
        nfcScanArea.classList.remove('scanning');
        nfcScanArea.classList.add('success');
      }

      playBeep(true);
      displayPatient(data);
      showToast(`${data.patient.first_name} ${data.patient.last_name} checked in!`, 'success');
      loadTodayQueue();
      if (cardInput) {
        cardInput.value = '';
        cardInput.focus();
      }

      // Reset scanning animation after 8 seconds
      autoResetTimer = setTimeout(() => {
        if (nfcScanArea) nfcScanArea.classList.remove('success');
      }, 8000);
    } catch (err) {
      playBeep(false);
      if (nfcScanArea) {
        nfcScanArea.classList.remove('scanning');
        nfcScanArea.classList.add('error');
      }
      showToast(err.message || 'Check-in failed', 'error');

      if (patientInfoPanel) {
        patientInfoPanel.style.display = 'block';
        if (patientNameEl) patientNameEl.textContent = '❌ Unregistered NFC Card';
        if (checkInStatusEl) {
          checkInStatusEl.textContent = 'Card Not Linked';
          checkInStatusEl.className = 'status-badge badge-danger';
        }
        if (patientAgeEl) patientAgeEl.textContent = '—';
        if (patientGenderEl) patientGenderEl.textContent = '—';
        if (patientBloodEl) patientBloodEl.textContent = '—';
        if (patientPhoneEl) patientPhoneEl.textContent = '—';
        if (patientEmergencyEl) patientEmergencyEl.textContent = '—';
        if (allergyBanner) allergyBanner.style.display = 'none';

        if (appointmentInfoEl) {
          appointmentInfoEl.innerHTML = `
            <div style="padding: 12px; background: #FEF2F2; border-radius: 8px; border: 1px solid #FCA5A5; margin-top: 8px;">
              <strong style="color: #991B1B; display: block; margin-bottom: 6px;"><i class="fas fa-exclamation-circle"></i> No Patient Assigned to Card: <code>${uid}</code></strong>
              <p style="color: #7F1D1D; font-size: 13px; margin-bottom: 12px;">This physical NFC chip has not yet been registered to an existing patient file.</p>
              <a href="admin.html?card_uid=${encodeURIComponent(uid)}" class="btn btn-sm btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                <i class="fas fa-id-card"></i> Enroll Patient with this Card in Admin
              </a>
            </div>
          `;
        }
      }
      if (cardInput) {
        cardInput.select();
      }

      setTimeout(() => {
        if (nfcScanArea) nfcScanArea.classList.remove('error');
      }, 4000);
    }
  }

  // ── Display Patient Details ───────────────────────────────────────
  function displayPatient(data) {
    const p = data.patient;
    if (!patientInfoPanel) return;

    if (patientNameEl) patientNameEl.textContent = `${p.first_name} ${p.last_name}`;
    if (patientAgeEl) patientAgeEl.textContent = p.age ? `${p.age} yrs` : '—';
    if (patientGenderEl) patientGenderEl.textContent = p.gender || '—';
    if (patientBloodEl) patientBloodEl.textContent = p.blood_group || '—';
    if (patientPhoneEl) patientPhoneEl.textContent = p.contact_phone || '—';
    if (patientEmergencyEl) {
      patientEmergencyEl.textContent = p.emergency_contact_name
        ? `${p.emergency_contact_name} (${p.emergency_contact_relation || 'Contact'}) - ${p.emergency_contact_phone || ''}`
        : '—';
    }

    // Status badge
    if (checkInStatusEl) {
      if (data.isWalkIn) {
        checkInStatusEl.textContent = 'Walk-in Arrived ✓';
        checkInStatusEl.className = 'status-badge badge-info';
      } else {
        checkInStatusEl.textContent = 'Checked In ✓';
        checkInStatusEl.className = 'status-badge badge-success';
      }
    }

    // Allergy alert
    if (allergyBanner && allergyText) {
      if (p.allergies && p.allergies.trim()) {
        allergyText.textContent = p.allergies;
        allergyBanner.style.display = 'flex';
      } else {
        allergyBanner.style.display = 'none';
      }
    }

    // Appointment detail
    if (appointmentInfoEl) {
      if (data.appointment) {
        const appt = data.appointment;
        appointmentInfoEl.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 8px;">
            <div><strong>Time:</strong> ${appt.appointment_time || 'Walk-in'}</div>
            <div><strong>Doctor:</strong> ${appt.doctor_name || 'Assigned on arrival'}</div>
            <div><strong>Department:</strong> ${appt.department || 'General'}</div>
            <div><strong>Reason:</strong> ${appt.reason || 'General Checkup'}</div>
          </div>
        `;
      } else {
        appointmentInfoEl.innerHTML = `<p>Walk-in visit initiated. Proceed to doctor desk.</p>`;
      }
    }

    patientInfoPanel.style.display = 'block';
  }

  // ── Load Today's Queue ────────────────────────────────────────────
  async function loadTodayQueue() {
    if (!queueTableBody) return;
    try {
      const response = await safeFetch('/api/appointments/today');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          if (typeof Auth !== 'undefined' && Auth.redirectToLogin) Auth.redirectToLogin();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const appointments = await response.json();

      if (queueCountEl) {
        queueCountEl.textContent = appointments.length;
      }

      if (!appointments || appointments.length === 0) {
        queueTableBody.innerHTML = `
          <tr class="empty-row">
            <td colspan="5"><i class="fas fa-inbox"></i> No appointments scheduled for today</td>
          </tr>
        `;
        return;
      }

      queueTableBody.innerHTML = appointments.map(a => {
        const isArrived = a.status === 'arrived';
        const statusHtml = isArrived
          ? `<span class="status-pill status-arrived"><span class="green-dot"></span> Arrived &amp; Waiting</span>`
          : `<span class="status-pill status-scheduled"><span class="orange-dot"></span> Scheduled</span>`;

        return `
          <tr class="table-capsule-row">
            <td><span class="arrival-time-cell"><span class="blue-dot"></span> ${a.appointment_time || 'Walk-in'}</span></td>
            <td>
              <div style="font-weight: 700; color: #0F172A;">${a.first_name} ${a.last_name}</div>
              <span class="nfc-chip-pill" style="margin-top: 4px;"><i class="fas fa-wifi" style="transform: rotate(90deg); font-size: 10px;"></i> ${a.card_uid || 'NFC'}</span>
            </td>
            <td style="font-weight: 500;">${a.doctor_name || 'Attending Physician'}</td>
            <td><span style="font-weight: 600; color: #334155;">${a.department || 'General'}</span></td>
            <td>${statusHtml}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  }

  // Initial load
  loadTodayQueue();
  setInterval(loadTodayQueue, 10000);

  // Sync across tabs
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('mediscan_')) {
      loadTodayQueue();
    }
  });
}

// Ensure execution whether DOM is already ready or loading
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReception);
} else {
  initReception();
}
                  