// Import auth module
// Auth is available globally from auth.js (window.Auth)

async function initDoctorDesk() {
  // Initialize authentication defensively
  if (typeof Auth !== 'undefined' && Auth && typeof Auth.initAuth === 'function') {
    try { await Auth.initAuth(); } catch (e) { console.warn('Auth init note:', e); }
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
        // Token was invalid/expired, retry cleanly without token
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

  // ── Toast Notification Helper ──────────────────────────────────────
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

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Clock Elements ────────────────────────────────────────────────
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

  // ── State Variables ────────────────────────────────────────────────
  let selectedDoctor = '';
  let currentPatient = null;
  let currentVisitId = null;
  let pendingPrescriptions = [];

  // ── DOM References ────────────────────────────────────────────────
  const doctorSelect = document.getElementById('doctorSelect');
  const nfcScanArea = document.querySelector('#doctorScanSection .nfc-scan-area') || document.getElementById('nfcScanArea');
  const cardInput = document.getElementById('doctorCardInput') || document.getElementById('cardInput');
  const loadPatientBtn = document.getElementById('btnLoadPatient') || document.getElementById('scanBtn');
  const patientRecordPanel = document.getElementById('patientRecordPanel');

  // Patient summary elements
  const drPatientName = document.getElementById('drPatientName');
  const drPatientAge = document.getElementById('drPatientAge');
  const drPatientGender = document.getElementById('drPatientGender');
  const drPatientBlood = document.getElementById('drPatientBlood');
  const drPatientPhone = document.getElementById('drPatientPhone');
  const drPatientEmergency = document.getElementById('drPatientEmergency');
  const drAllergyAlert = document.getElementById('drAllergyAlert');
  const drAllergies = document.getElementById('drAllergies');
  const drChronicAlert = document.getElementById('drChronicAlert');
  const drChronic = document.getElementById('drChronic');
  const btnCheckoutPatient = document.getElementById('btnCheckoutPatient');

  // Vitals elements
  const vitalsForm = document.getElementById('vitalsForm');
  const vitalBP = document.getElementById('vitalBP');
  const vitalTemp = document.getElementById('vitalTemp');
  const vitalWeight = document.getElementById('vitalWeight');
  const vitalHR = document.getElementById('vitalHR');
  const vitalSpO2 = document.getElementById('vitalSpO2');

  // Visit history
  const visitHistoryAccordion = document.getElementById('visitHistoryAccordion');

  // Current visit form
  const currentVisitForm = document.getElementById('currentVisitForm');
  const visitSymptoms = document.getElementById('visitSymptoms');
  const visitDiagnosis = document.getElementById('visitDiagnosis');
  const visitNotes = document.getElementById('visitNotes');

  // Prescriptions
  const prescriptionForm = document.getElementById('prescriptionForm');
  const btnAddMedicine = document.getElementById('btnAddMedicine');
  const prescriptionList = document.getElementById('prescriptionList');
  const prescriptionListBody = document.getElementById('prescriptionListBody');
  const btnSubmitPrescription = document.getElementById('btnSubmitPrescription');

  // Lab reports
  const labReportsBody = document.getElementById('labReportsBody');
  const labReportForm = document.getElementById('labReportForm');

  // Sidebar
  const myPatientsToday = document.getElementById('myPatientsToday');
  const emptyDoctorStation = document.getElementById('emptyDoctorStation');

  // Autofocus NFC Card Input for USB readers
  if (cardInput) {
    cardInput.focus();
  }

  // Follow-up toggle handler
  const chkScheduleFollowup = document.getElementById('chkScheduleFollowup');
  const appointmentFieldsBox = document.getElementById('appointmentFieldsBox');
  if (chkScheduleFollowup && appointmentFieldsBox) {
    chkScheduleFollowup.addEventListener('change', () => {
      appointmentFieldsBox.style.display = chkScheduleFollowup.checked ? 'block' : 'none';
    });
  }

  // ── Load Doctors ──────────────────────────────────────────────────
  function populateDoctorDropdown(doctors) {
    const el = document.getElementById('doctorSelect') || doctorSelect;
    if (el && Array.isArray(doctors)) {
      const prevSelected = el.value || selectedDoctor;
      el.innerHTML = '<option value="">Select Doctor Profile…</option>' +
        doctors.map(d => `<option value="${d.name}">${d.name} (${d.department || ''})</option>`).join('');
      if (prevSelected && Array.from(el.options).some(o => o.value === prevSelected)) {
        el.value = prevSelected;
      }
    }
  }

  async function loadDoctors() {
    try {
      const cached = localStorage.getItem('mediscan_cached_doctors');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          populateDoctorDropdown(parsed);
        }
      }
    } catch (e) {}

    try {
      const response = await safeFetch('/api/doctors');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const doctors = await response.json();
      try {
        localStorage.setItem('mediscan_cached_doctors', JSON.stringify(doctors));
      } catch (e) {}
      populateDoctorDropdown(doctors);
    } catch (err) {
      console.error('Failed to load doctors:', err);
    }
  }
  loadDoctors();

  const elDoc = document.getElementById('doctorSelect') || doctorSelect;
  if (elDoc) {
    elDoc.addEventListener('change', () => {
      selectedDoctor = elDoc.value;
      loadMyPatients();
    });
    // Auto-refresh when dropdown is focused or clicked to show newly added doctors
    elDoc.addEventListener('focus', loadDoctors);
  }

  // ── Load Hospital Departments for Follow-up Suggestion ────────────
  function populateDeptDatalist(depts) {
    const listEl = document.getElementById('followupDeptList');
    if (listEl && Array.isArray(depts)) {
      listEl.innerHTML = depts.map(d => `<option value="${d.name}">`).join('');
    }
  }

  async function loadDepartments() {
    try {
      const cached = localStorage.getItem('mediscan_cached_departments');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          populateDeptDatalist(parsed);
        }
      }
    } catch (e) {}

    try {
      const response = await safeFetch('/api/departments');
      if (!response.ok) return;
      const depts = await response.json();
      try {
        localStorage.setItem('mediscan_cached_departments', JSON.stringify(depts));
      } catch (e) {}
      populateDeptDatalist(depts);
    } catch (e) {}
  }
  loadDepartments();

  // Cross-tab real-time sync when doctors or appointments are added in Admin or other tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'mediscan_doctors_updated') {
      loadDoctors();
    }
    if (e.key === 'mediscan_departments_updated') {
      loadDepartments();
    }
    if (e.key === 'mediscan_patients_updated' || e.key === 'mediscan_queue_updated') {
      loadMyPatients();
    }
  });

  // Periodic poll so newly added doctors show up automatically without page reload
  setInterval(loadDoctors, 8000);
  setInterval(loadDepartments, 15000);

  // ── Web NFC API Integration ────────────────────────────────────────
  async function setupWebNFC() {
    if ('NDEFReader' in window) {
      try {
        const ndef = new NDEFReader();
        await ndef.scan();
        ndef.addEventListener('reading', ({ serialNumber }) => {
          const uid = serialNumber ? serialNumber.replace(/:/g, '').toUpperCase() : '';
          loadPatientRecord(uid);
        });
        showToast('NFC reader active! Tap patient card on device.', 'info');
      } catch (err) {
        console.info('Web NFC not started:', err.message);
      }
    }
  }
  setupWebNFC();

  // ── Manual Card Search Trigger ─────────────────────────────────────
  if (loadPatientBtn) {
    loadPatientBtn.addEventListener('click', () => {
      const uid = cardInput?.value.trim();
      if (!uid) {
        showToast('Please enter or tap a Card UID', 'error');
        return;
      }
      loadPatientRecord(uid);
    });
  }

  if (cardInput) {
    cardInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadPatientBtn?.click();
      }
    });
  }

  // ── Load Full Patient Record ───────────────────────────────────────
  async function loadPatientRecord(uid) {
    if (nfcScanArea) {
      nfcScanArea.classList.remove('success', 'error');
      nfcScanArea.classList.add('scanning');
    }

    try {
      const response = await safeFetch(`/api/patients/card/${encodeURIComponent(uid)}`);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          Auth.redirectToLogin();
          return;
        }
        throw new Error('Failed to load patient record');
      }
      const data = await response.json();
      currentPatient = data.patient || data;
      currentPatient.visits = data.visits || currentPatient.visits || [];
      currentPatient.appointments = data.appointments || currentPatient.appointments || [];
      currentPatient.lab_reports = data.lab_reports || data.labReports || currentPatient.lab_reports || [];

      if (nfcScanArea) {
        nfcScanArea.classList.remove('scanning');
        nfcScanArea.classList.add('success');
        setTimeout(() => nfcScanArea.classList.remove('success'), 4000);
      }

      // Check or create active visit
      await ensureActiveVisit(currentPatient);

      // Render all sections
      renderPatientSummary(currentPatient);
      renderVisitHistory(currentPatient.visits);
      renderLabReports(currentPatient.lab_reports);

      // Populate follow-up appointment & notification form
      populateFollowupForm(currentPatient);
      loadPatientNotificationHistory(currentPatient.id);

      // Clear prescription staging
      pendingPrescriptions = [];
      renderPrescriptionList();

      if (patientRecordPanel) {
        patientRecordPanel.style.display = 'block';
        if (emptyDoctorStation) emptyDoctorStation.style.display = 'none';
        patientRecordPanel.scrollIntoView({ behavior: 'smooth' });
      }

      showToast(`Loaded ${currentPatient.first_name} ${currentPatient.last_name}`, 'success');
      loadMyPatients();
    } catch (err) {
      if (nfcScanArea) {
        nfcScanArea.classList.remove('scanning');
        nfcScanArea.classList.add('error');
        setTimeout(() => nfcScanArea.classList.remove('error'), 3000);
      }
      showToast(err.message || 'Failed to load patient record', 'error');
    }
  }

  // ── Ensure Active Visit Exists ─────────────────────────────────────
  async function ensureActiveVisit(patient) {
    const visits = patient.visits || [];
    const active = visits.find(v => v.status === 'checked_in' || v.status === 'in_progress');

    if (active) {
      currentVisitId = active.id;
      // Pre-fill existing current visit inputs if already documented
      if (visitSymptoms) visitSymptoms.value = active.symptoms || '';
      if (visitDiagnosis) visitDiagnosis.value = active.diagnosis || '';
      if (visitNotes) visitNotes.value = active.notes || '';
      if (active.vitals) {
        try {
          const vObj = JSON.parse(active.vitals);
          if (vitalBP) vitalBP.value = vObj.blood_pressure || '';
          if (vitalTemp) vitalTemp.value = vObj.temperature || '';
          if (vitalWeight) vitalWeight.value = vObj.weight || '';
          if (vitalHR) vitalHR.value = vObj.heart_rate || '';
          if (vitalSpO2) vitalSpO2.value = vObj.spo2 || '';
        } catch (e) {}
      }
    } else {
      // Create a fresh consultation visit for this patient
      try {
        const response = await safeFetch('/api/visits', {
          method: 'POST',
          body: JSON.stringify({
            patient_id: patient.id,
            doctor_name: selectedDoctor || 'Attending Physician',
            department: 'General',
            status: 'checked_in'
          })
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error auto-creating visit');
        }
        const newVisit = await response.json();
        currentVisitId = newVisit.id;
        patient.visits.unshift(newVisit);
      } catch (e) {
        console.error('Error auto-creating visit:', e);
      }
    }
  }

  // ── Render Summary ────────────────────────────────────────────────
  function renderPatientSummary(p) {
    if (drPatientName) drPatientName.textContent = `${p.first_name} ${p.last_name}`;
    const cardChipVal = document.getElementById('drCardChipVal');
    if (cardChipVal) cardChipVal.textContent = p.card_uid;
    if (drPatientAge) drPatientAge.textContent = p.age ? `${p.age} yrs` : '—';
    if (drPatientGender) drPatientGender.textContent = p.gender || '—';
    if (drPatientBlood) drPatientBlood.textContent = p.blood_group || '—';
    if (drPatientPhone) drPatientPhone.textContent = p.contact_phone || '—';
    if (drPatientEmergency) {
      drPatientEmergency.textContent = p.emergency_contact_name
        ? `${p.emergency_contact_name} (${p.emergency_contact_relation || 'Contact'}) - ${p.emergency_contact_phone || ''}`
        : '—';
    }

    // Allergies
    if (drAllergyAlert && drAllergies) {
      if (p.allergies && p.allergies.trim()) {
        drAllergies.textContent = p.allergies;
        drAllergyAlert.style.display = 'block';
      } else {
        drAllergyAlert.style.display = 'none';
      }
    }

    // Chronic conditions
    if (drChronicAlert && drChronic) {
      if (p.chronic_conditions && p.chronic_conditions.trim()) {
        drChronic.textContent = p.chronic_conditions;
        drChronicAlert.style.display = 'block';
      } else {
        drChronicAlert.style.display = 'none';
      }
    }
  }

  // ── Render Visit History Accordion ────────────────────────────────
  function renderVisitHistory(visits) {
    if (!visitHistoryAccordion) return;

    // Filter out the current active empty visit if present
    const pastVisits = (visits || []).filter(v => v.id !== currentVisitId || v.status === 'completed' || v.diagnosis);

    if (pastVisits.length === 0) {
      visitHistoryAccordion.innerHTML = `<p class="empty-message"><i class="fas fa-inbox"></i> No previous visits on file.</p>`;
      return;
    }

    visitHistoryAccordion.innerHTML = pastVisits.map((v, idx) => {
      let vitalsText = '—';
      if (v.vitals) {
        try {
          const parsed = JSON.parse(v.vitals);
          vitalsText = Object.entries(parsed)
            .filter(([_, val]) => val)
            .map(([k, val]) => `${k.replace('_', ' ')}: ${val}`)
            .join(' | ');
        } catch(e) {
          vitalsText = v.vitals;
        }
      }

      const medsHTML = (v.prescriptions && v.prescriptions.length > 0)
        ? `
          <table class="data-table" style="margin-top: 8px;">
            <thead>
              <tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr>
            </thead>
            <tbody>
              ${v.prescriptions.map(p => `
                <tr>
                  <td><strong>${p.medicine_name}</strong></td>
                  <td>${p.dosage || '—'}</td>
                  <td>${p.frequency || '—'}</td>
                  <td>${p.duration || '—'}</td>
                  <td>${p.instructions || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        : '<p style="color: #888; font-size: 13px;">No medications prescribed during this visit.</p>';

      return `
        <div class="accordion-item" style="border: 1px solid #E0E0E0; border-radius: 8px; margin-bottom: 10px; overflow: hidden;">
          <button type="button" class="accordion-toggle" data-idx="${idx}" style="width: 100%; text-align: left; padding: 12px 16px; background: #F8F9FA; border: none; font-weight: 600; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
            <span><i class="fas fa-calendar-alt"></i> ${formatDate(v.visit_date)} &bull; ${v.doctor_name || 'Doctor'} (${v.department || 'General'})</span>
            <span class="badge ${v.status === 'completed' ? 'badge-success' : 'badge_info'}">${v.status || 'completed'}</span>
          </button>
          <div class="accordion-content" id="visitContent-${idx}" style="padding: 16px; border-top: 1px solid #E0E0E0; display: none;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
              <div><strong>Symptoms:</strong> ${v.symptoms || '—'}</div>
              <div><strong>Diagnosis:</strong> <span style="color:#0077B6; font-weight: 600;">${v.diagnosis || '—'}</span></div>
              <div><strong>Vitals:</strong> ${vitalsText}</div>
              <div><strong>Check In / Out:</strong> ${formatDateTime(v.check_in_time)} - ${formatDateTime(v.check_out_time)}</div>
            </div>
            ${v.notes ? `<div style="margin-bottom: 12px;"><strong>Clinical Notes:</strong> ${v.notes}</div>` : ''}
            <h5 style="margin-top: 12px; margin-bottom: 6px;"><i class="fas fa-pills"></i> Prescribed Medicines:</h5>
            ${medsHTML}
          </div>
        </div>
      `;
    }).join('');

    // Toggle listener
    visitHistoryAccordion.querySelectorAll('.accordion-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.idx;
        const content = document.getElementById(`visitContent-${idx}`);
        if (content) {
          const isOpen = content.style.display === 'block';
          content.style.display = isOpen ? 'none' : 'block';
        }
      });
    });
  }

  // ── Render Lab Reports ─────────────────────────────────────────────
  function renderLabReports(reports) {
    if (!labReportsBody) return;
    if (!reports || reports.length === 0) {
      labReportsBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="5"><i class="fas fa-inbox"></i> No lab reports on file</td>
        </tr>
      `;
      return;
    }

    labReportsBody.innerHTML = reports.map(r => `
      <tr>
        <td><strong>${r.test_name}</strong></td>
        <td><span style="font-weight: 600; color: #0077B6;">${r.result || '—'}</span></td>
        <td>${r.normal_range || '—'}</td>
        <td>${r.notes || '—'}</td>
        <td>${formatDate(r.created_at)}</td>
      </tr>
    `).join('');
  }

  // ── Save Vitals ───────────────────────────────────────────────────
  if (vitalsForm) {
    vitalsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentVisitId) {
        showToast('Please load a patient first', 'error');
        return;
      }

      const vitalsObj = {
        blood_pressure: vitalBP?.value.trim() || '',
        temperature: vitalTemp?.value.trim() || '',
        weight: vitalWeight?.value.trim() || '',
        heart_rate: vitalHR?.value.trim() || '',
        spo2: vitalSpO2?.value.trim() || ''
      };

      try {
        const response = await safeFetch(`/api/visits/${currentVisitId}`, {
          method: 'PUT',
          body: JSON.stringify({ vitals: JSON.stringify(vitalsObj) })
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error saving vitals');
        }
        showToast('Patient vitals saved successfully!', 'success');
      } catch (err) {
        showToast(err.message || 'Error saving vitals', 'error');
      }
    });
  }

  // ── Save Visit Notes / Diagnosis ──────────────────────────────────
  if (currentVisitForm) {
    currentVisitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentVisitId) {
        showToast('Please load a patient first', 'error');
        return;
      }

      const payload = {
        symptoms: visitSymptoms?.value.trim() || '',
        diagnosis: visitDiagnosis?.value.trim() || '',
        notes: visitNotes?.value.trim() || '',
        doctor_name: selectedDoctor || undefined
      };

      try {
        const response = await safeFetch(`/api/visits/${currentVisitId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error saving visit info');
        }
        showToast('Diagnosis and visit notes saved!', 'success');
      } catch (err) {
        showToast(err.message || 'Error saving visit info', 'error');
      }
    });
  }

  // ── Add Medicine to Prescribe Staging List ──────────────────────────
  if (btnAddMedicine) {
    btnAddMedicine.addEventListener('click', () => {
      if (!currentPatient) {
        showToast('Please load a patient first', 'error');
        return;
      }

      const nameEl = document.getElementById('medName');
      const dosageEl = document.getElementById('medDosage');
      const freqEl = document.getElementById('medFrequency');
      const durEl = document.getElementById('medDuration');
      const instEl = document.getElementById('medInstructions');

      const name = nameEl?.value.trim();
      if (!name) {
        showToast('Medicine name is required', 'error');
        nameEl?.focus();
        return;
      }

      pendingPrescriptions.push({
        medicine_name: name,
        dosage: dosageEl?.value.trim() || '',
        frequency: freqEl?.value || 'Once daily',
        duration: durEl?.value.trim() || '5 days',
        instructions: instEl?.value.trim() || ''
      });

      // Clear fields
      if (nameEl) nameEl.value = '';
      if (dosageEl) dosageEl.value = '';
      if (durEl) durEl.value = '';
      if (instEl) instEl.value = '';

      renderPrescriptionList();
      showToast(`Added ${name} to prescription list`, 'info');
    });
  }

  function renderPrescriptionList() {
    if (!prescriptionList || !prescriptionListBody) return;

    if (pendingPrescriptions.length === 0) {
      prescriptionList.style.display = 'none';
      prescriptionListBody.innerHTML = '';
      return;
    }

    prescriptionList.style.display = 'block';
    prescriptionListBody.innerHTML = pendingPrescriptions.map((m, idx) => `
      <tr>
        <td><strong>${m.medicine_name}</strong></td>
        <td>${m.dosage || '—'}</td>
        <td>${m.frequency || '—'}</td>
        <td>${m.duration || '—'}</td>
        <td>${m.instructions || '—'}</td>
        <td>
          <button type="button" class="btn btn-sm btn-danger remove-med-btn" data-idx="${idx}">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');

    prescriptionListBody.querySelectorAll('.remove-med-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx);
        pendingPrescriptions.splice(i, 1);
        renderPrescriptionList();
      });
    });
  }

  // ── Submit All Prescriptions ───────────────────────────────────────
  if (btnSubmitPrescription) {
    btnSubmitPrescription.addEventListener('click', async () => {
      if (!currentPatient || !currentVisitId) {
        showToast('Please load a patient first', 'error');
        return;
      }
      if (pendingPrescriptions.length === 0) {
        showToast('No medicines added to prescribe', 'error');
        return;
      }

      try {
        for (const item of pendingPrescriptions) {
          const response = await safeFetch('/api/prescriptions', {
            method: 'POST',
            body: JSON.stringify({
              visit_id: currentVisitId,
              patient_id: currentPatient.id,
              medicine_name: item.medicine_name,
              dosage: item.dosage,
              frequency: item.frequency,
              duration: item.duration,
              instructions: item.instructions,
              prescribed_by: selectedDoctor || 'Attending Doctor'
            })
          });
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              Auth.redirectToLogin();
              return;
            }
            throw new Error('Failed to create prescription');
          }
        }

        showToast(`${pendingPrescriptions.length} medications prescribed & saved to NFC card!`, 'success');
        pendingPrescriptions = [];
        renderPrescriptionList();

        // Refresh patient record to update visit history
        if (currentPatient.card_uid) {
          loadPatientRecord(currentPatient.card_uid);
        }
      } catch (err) {
        showToast('Failed to submit prescriptions', 'error');
      }
    });
  }

  // ── Add Lab Report ────────────────────────────────────────────────
  if (labReportForm) {
    labReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentPatient) {
        showToast('Please load a patient first', 'error');
        return;
      }

      const testName = document.getElementById('labTestName')?.value.trim();
      const result = document.getElementById('labResult')?.value.trim();
      const normalRange = document.getElementById('labNormalRange')?.value.trim();
      const notes = document.getElementById('labNotes')?.value.trim();

      if (!testName) {
        showToast('Test name is required', 'error');
        return;
      }

      try {
        const response = await safeFetch('/api/lab-reports', {
          method: 'POST',
          body: JSON.stringify({
            patient_id: currentPatient.id,
            visit_id: currentVisitId,
            test_name: testName,
            result,
            normal_range: normalRange,
            notes,
            status: 'completed'
          })
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error adding lab report');
        }

        showToast('Lab report added successfully!', 'success');
        labReportForm.reset();

        // Refresh record
        if (currentPatient.card_uid) {
          loadPatientRecord(currentPatient.card_uid);
        }
      } catch (err) {
        showToast(err.message || 'Error adding lab report', 'error');
      }
    });
  }

  // ── Checkout Patient ──────────────────────────────────────────────
  if (btnCheckoutPatient) {
    btnCheckoutPatient.addEventListener('click', async () => {
      if (!currentVisitId || !currentPatient) {
        showToast('No active patient loaded', 'error');
        return;
      }

      const confirmed = typeof showConfirmDialog === 'function'
        ? await showConfirmDialog({
            title: 'Complete Consultation & Checkout',
            message: `Are you sure you want to finalize the clinical consultation and checkout <strong>${currentPatient.first_name} ${currentPatient.last_name}</strong>?`,
            confirmText: 'Checkout Patient',
            cancelText: 'Stay on File',
            type: 'success',
            icon: 'fas fa-clipboard-check'
          })
        : confirm(`Complete consultation and checkout ${currentPatient.first_name} ${currentPatient.last_name}?`);

      if (!confirmed) {
        return;
      }

      try {
        const response = await safeFetch(`/api/visits/${currentVisitId}`, {
          method: 'PUT',
          body: JSON.stringify({
            status: 'completed',
            check_out_time: new Date().toLocaleString('sv-SE')
          })
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error checking out patient');
        }

        showToast(`${currentPatient.first_name} ${currentPatient.last_name} consultation completed!`, 'success');

        // Reset screen
        currentPatient = null;
        currentVisitId = null;
        pendingPrescriptions = [];
        if (patientRecordPanel) patientRecordPanel.style.display = 'none';
        if (emptyDoctorStation) emptyDoctorStation.style.display = 'block';
        if (cardInput) {
          cardInput.value = '';
          cardInput.focus();
        }
        if (vitalsForm) vitalsForm.reset();
        if (currentVisitForm) currentVisitForm.reset();
        loadMyPatients();
      } catch (err) {
        showToast(err.message || 'Error checking out patient', 'error');
      }
    });
  }

  // ── Populate Follow-Up Appointment & Notification Form ────────────
  function populateFollowupForm(patient) {
    const notifEmail = document.getElementById('notifEmail');
    const notifPhone = document.getElementById('notifPhone');
    const followupDoctor = document.getElementById('followupDoctor');
    const followupDept = document.getElementById('followupDept');
    const followupDate = document.getElementById('followupDate');
    const followupReason = document.getElementById('followupReason');
    const resultCard = document.getElementById('notifDeliveryResult');

    if (resultCard) resultCard.style.display = 'none';

    if (notifEmail) notifEmail.value = patient.contact_email || '';
    if (notifPhone) notifPhone.value = patient.contact_phone || '';
    if (followupDoctor) followupDoctor.value = selectedDoctor || '';
    if (followupDept) followupDept.value = (patient.visits && patient.visits[0] && patient.visits[0].department) || 'General Medicine';
    if (followupReason) followupReason.value = 'Follow-up consultation and medication review';

    // Default next appointment to 14 days from today
    if (followupDate && !followupDate.value) {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      followupDate.value = `${y}-${m}-${day}`;
    }
  }

  // Quick date selector buttons
  document.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const d = new Date();
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const followupDate = document.getElementById('followupDate');
      if (followupDate) followupDate.value = `${y}-${m}-${day}`;
      showToast(`Follow-up set to ${days} days from today`, 'info');
    });
  });

  // ── Submit Follow-up & Notifications (Email & WhatsApp) ────────────
  const followupForm = document.getElementById('followupForm');
  if (followupForm) {
    followupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentPatient) {
        showToast('Please load a patient first', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSendFollowup');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scheduling & Transmitting...';
      }

      try {
        const shouldScheduleAppt = document.getElementById('chkScheduleFollowup')?.checked ?? true;
        const payload = {
          patient_id: currentPatient.id,
          visit_id: currentVisitId,
          followup_date: shouldScheduleAppt ? document.getElementById('followupDate')?.value : null,
          followup_time: shouldScheduleAppt ? (document.getElementById('followupTime')?.value || '10:00') : null,
          department: document.getElementById('followupDept')?.value || 'General',
          doctor_name: document.getElementById('followupDoctor')?.value || selectedDoctor || 'Attending Physician',
          reason: document.getElementById('followupReason')?.value || 'Clinical consultation summary',
          target_email: document.getElementById('notifEmail')?.value.trim(),
          target_phone: document.getElementById('notifPhone')?.value.trim(),
          send_email: document.getElementById('chkSendEmail')?.checked ?? true,
          send_whatsapp: document.getElementById('chkSendWhatsApp')?.checked ?? true,
        };

        const response = await safeFetch('/api/doctor/followup-and-notify', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            Auth.redirectToLogin();
            return;
          }
          throw new Error('Error sending notifications');
        }

        const data = await response.json();

        // Display rich result card
        const resultCard = document.getElementById('notifDeliveryResult');
        const detailsList = document.getElementById('notifDetailsList');
        const btnWA = document.getElementById('btnOpenWhatsApp');
        const btnEmail = document.getElementById('btnPreviewEmail');

        if (resultCard && detailsList) {
          let html = ``;
          if (data.appointment) {
            html += `<div style="margin-bottom: 4px;">📅 <strong>Follow-up Scheduled:</strong> ${data.appointment.appointment_date} at ${data.appointment.appointment_time || '10:00 AM'} with ${data.appointment.doctor_name}</div>`;
          }
          if (data.email) {
            html += `<div style="margin-bottom: 4px;">✉️ <strong>Email Dossier:</strong> ${data.email.success ? `Delivered to <strong>${data.email.recipient}</strong>` : `<span style="color:#e74c3c">Failed: ${data.email.error}</span>`}</div>`;
          }
          if (data.whatsapp) {
            html += `<div style="margin-bottom: 4px;">💬 <strong>WhatsApp Summary:</strong> ${data.whatsapp.success ? `Prepared & sent for <strong>${data.whatsapp.recipient}</strong>` : `<span style="color:#e74c3c">Failed: ${data.whatsapp.error}</span>`}</div>`;
          }
          detailsList.innerHTML = html;

          // WhatsApp direct open button
          if (btnWA && data.whatsapp && data.whatsapp.whatsappUrl) {
            btnWA.href = data.whatsapp.whatsappUrl;
            btnWA.style.display = 'inline-flex';
          } else if (btnWA) {
            btnWA.style.display = 'none';
          }

          // View email button
          if (btnEmail && data.email && data.email.notification_id) {
            btnEmail.href = `/api/notifications/view-email/${data.email.notification_id}`;
            btnEmail.style.display = 'inline-flex';
          } else if (btnEmail) {
            btnEmail.style.display = 'none';
          }

          // Download PDF button
          const btnPdf = document.getElementById('btnDownloadPdf');
          if (btnPdf && currentVisitId) {
            btnPdf.href = `/api/visits/${currentVisitId}/pdf`;
            btnPdf.style.display = 'inline-flex';
          } else if (btnPdf) {
            btnPdf.style.display = 'none';
          }

          resultCard.style.display = 'block';
          resultCard.scrollIntoView({ behavior: 'smooth' });
        }

        if (data.email && data.email.success === false) {
          showToast(`Appointment scheduled, but email failed: ${data.email.error || 'Delivery issue'}`, 'warning');
        } else {
          showToast('Appointment scheduled & summary dispatched to Email & WhatsApp!', 'success');
        }
        loadPatientNotificationHistory(currentPatient.id);
      } catch (err) {
        showToast(err.message || 'Error sending notifications', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Schedule Next Appointment & Send to Patient';
        }
      }
    });
  }

  // ── Load Notification History for Patient ─────────────────────────
  async function loadPatientNotificationHistory(patientId) {
    const listEl = document.getElementById('patientNotifHistory');
    if (!listEl) return;

    try {
      const response = await safeFetch(`/api/notifications/patient/${patientId}`);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          Auth.redirectToLogin();
          return;
        }
        throw new Error('Failed to load notification history');
      }
      const notifs = await response.json();

      if (!notifs || notifs.length === 0) {
        listEl.innerHTML = `<li style="color: #94A3B8; padding: 4px 0;">No previous notifications sent to this patient.</li>`;
        return;
      }

      listEl.innerHTML = notifs.map(n => {
        const isEmail = n.channel === 'email';
        const icon = isEmail ? '<i class="fas fa-envelope" style="color:#0077B6;"></i> Email' : '<i class="fab fa-whatsapp" style="color:#25D366;"></i> WhatsApp';
        const viewLink = isEmail
          ? ` &bull; <a href="/api/notifications/view-email/${n.id}" target="_blank" style="color:#0077B6; font-weight:600; text-decoration:underline;">View Rendered Email</a>`
          : '';

        return `
          <li style="padding: 8px 12px; background: #F8FAFC; border-radius: 6px; margin-bottom: 6px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${icon}</strong> &rarr; <span style="font-family: monospace;">${n.recipient}</span>
              <span style="color: #64748B; font-size: 12px;">(${formatDateTime(n.sent_at)})</span>
              ${viewLink}
            </div>
            <span class="badge badge-success" style="font-size: 11px;">${n.status}</span>
          </li>
        `;
      }).join('');
    } catch (e) {
      console.warn('Failed to load notification history:', e);
    }
  }

  // ── My Patients Today (Sidebar) ───────────────────────────────────
  async function loadMyPatients() {
    if (!myPatientsToday) return;

    try {
      const response = await safeFetch('/api/appointments/today');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          Auth.redirectToLogin();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      let list = await response.json();

      // Filter by doctor if selected
      if (selectedDoctor) {
        list = list.filter(a => !a.doctor_name || a.doctor_name === selectedDoctor);
      }

      const countBadge = document.getElementById('sidebarQueueCount');
      if (countBadge) countBadge.textContent = `${list ? list.length : 0} Patients`;

      if (!list || list.length === 0) {
        myPatientsToday.innerHTML = `<li class="empty-message"><i class="fas fa-inbox"></i> No appointments today</li>`;
        return;
      }

      myPatientsToday.innerHTML = list.map(a => {
        const isArrived = a.status === 'arrived';
        const statusHtml = isArrived
          ? `<span class="status-pill status-arrived" style="font-size: 11px; padding: 3px 10px;"><span class="green-dot"></span> Arrived</span>`
          : `<span class="status-pill status-scheduled" style="font-size: 11px; padding: 3px 10px;"><span class="orange-dot"></span> Scheduled</span>`;

        return `
          <li class="queue-item" data-uid="${a.card_uid}" style="background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(255, 255, 255, 0.85); border-radius: 16px; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 2px 8px rgba(0, 45, 110, 0.03);">
            <div>
              <div style="font-weight: 700; color: #0F172A; font-size: 13.5px;">${a.first_name} ${a.last_name}</div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 3px;">
                <span style="color: #64748B; font-size: 11.5px; font-weight: 500;">${a.appointment_time || 'Walk-in'}</span>
                <span class="nfc-chip-pill" style="font-size: 10px; padding: 2px 8px;"><i class="fas fa-wifi" style="transform: rotate(90deg); font-size: 9px;"></i> ${a.card_uid || 'NFC'}</span>
              </div>
            </div>
            ${statusHtml}
          </li>
        `;
      }).join('');

      myPatientsToday.querySelectorAll('.queue-item').forEach(item => {
        item.addEventListener('click', () => {
          const uid = item.dataset.uid;
          if (uid) {
            if (cardInput) cardInput.value = uid;
            loadPatientRecord(uid);
          }
        });
      });
    } catch (err) {
      console.error('Failed to load my patients today:', err);
    }
  }

  loadMyPatients();
  setInterval(loadMyPatients, 20000);
}

// Ensure execution whether DOM is already ready or loading
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDoctorDesk);
} else {
  initDoctorDesk();
}