// Import auth module
// Auth is available globally from auth.js (window.Auth)

async function initAdmin() {
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

  // ── DOM References ────────────────────────────────────────────────
  const patientForm = document.getElementById('patientRegistrationForm') || document.getElementById('patientForm');
  const btnGenerateUID = document.getElementById('btnGenerateUID') || document.getElementById('generateCardBtn');
  const regCardUID = document.getElementById('regCardUID') || document.getElementById('cardUidInput');
  const regDOB = document.getElementById('regDOB') || document.getElementById('dobInput');
  const regAge = document.getElementById('regAge') || document.getElementById('ageInput');

  // Search & Patient List Table
  const patientSearch = document.getElementById('patientSearch') || document.getElementById('searchInput');
  const patientTableBody = document.getElementById('patientTableBody') || document.getElementById('patientList');

  // Modals
  const cardSummaryModal = document.getElementById('cardSummaryModal');
  const summaryCardUID = document.getElementById('summaryCardUID');
  const summaryPatientName = document.getElementById('summaryPatientName');
  const summaryPatientMeta = document.getElementById('summaryPatientMeta');
  const summaryPatientPhone = document.getElementById('summaryPatientPhone');
  const btnCloseCardSummary = document.getElementById('btnCloseCardSummary');
  const btnCloseSummary = document.getElementById('btnCloseSummary');

  const patientDetailModal = document.getElementById('patientDetailModal');
  const patientDetailContent = document.getElementById('patientDetailContent');
  const btnClosePatientDetail = document.getElementById('btnClosePatientDetail');
  const btnCloseDetail = document.getElementById('btnCloseDetail');

  // Appointment Scheduling
  const appointmentForm = document.getElementById('appointmentForm');
  const apptPatient = document.getElementById('apptPatient');
  const apptDoctor = document.getElementById('apptDoctor');
  const apptDepartment = document.getElementById('apptDepartment');
  const apptDate = document.getElementById('apptDate');

  // Doctor Management
  const doctorForm = document.getElementById('doctorForm');
  const doctorTableBody = document.getElementById('doctorTableBody');
  const btnAddDoctor = document.getElementById('btnAddDoctor');
  const btnCancelEditDoctor = document.getElementById('btnCancelEditDoctor');
  const docName = document.getElementById('docName');
  const docDepartment = document.getElementById('docDepartment');
  const docSpecialization = document.getElementById('docSpecialization');

  // Department Management
  const departmentSection = document.getElementById('departmentSection');
  const departmentForm = document.getElementById('departmentForm');
  const deptName = document.getElementById('deptName');
  const deptDescription = document.getElementById('deptDescription');
  const btnAddDepartment = document.getElementById('btnAddDepartment');
  const btnCancelEditDept = document.getElementById('btnCancelEditDept');
  const departmentTableBody = document.getElementById('departmentTableBody');
  const deptCountBadge = document.getElementById('deptCountBadge');
  const hospitalDeptList = document.getElementById('hospitalDeptList');

  let editingDoctorId = null;
  let editingDepartmentId = null;
  let editingPatientId = null;
  let allPatientsCache = [];
  let allDepartmentsCache = [];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Pre-fill card UID from URL query if directed from Reception or Doctor Desk
  const urlParams = new URLSearchParams(window.location.search);
  const paramCardUID = urlParams.get('card_uid');
  if (paramCardUID && regCardUID) {
    regCardUID.value = paramCardUID;
    showToast(`Pre-loaded NFC Card UID: ${paramCardUID}`, 'info');
    const firstInput = document.getElementById('regFirstName');
    if (firstInput) firstInput.focus();
  }

  // ── Auto-calculate Age from DOB ────────────────────────────────────
  if (btnGenerateUID && regCardUID) {
    btnGenerateUID.addEventListener('click', () => {
      const hex = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join('');
      regCardUID.value = `NFC-${hex}`;
      showToast(`Auto-generated Card UID: NFC-${hex}`, 'info');
    });
  }

  if (regDOB) {
    regDOB.addEventListener('change', () => {
      const dob = new Date(regDOB.value);
      if (isNaN(dob)) return;
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      if (regAge) regAge.value = Math.max(0, age);
    });
  }

  // ── Patient Registration / Update ──────────────────────────────────
  if (patientForm) {
    patientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(patientForm);
      const data = Object.fromEntries(formData.entries());

      // Validate mandatory NFC Card UID (No automatic dummy generation)
      if (!data.card_uid || !data.card_uid.trim()) {
        showToast('NFC Card UID is required. Please tap/scan the patient card or enter the UID.', 'error');
        if (regCardUID) {
          regCardUID.focus();
          regCardUID.classList.add('input-error-highlight');
          setTimeout(() => regCardUID.classList.remove('input-error-highlight'), 2000);
        }
        return;
      }
      data.card_uid = data.card_uid.trim();

      if (data.age) data.age = parseInt(data.age);

      try {
        const response = editingPatientId
          ? await safeFetch(`/api/patients/${editingPatientId}`, {
              method: 'PUT',
              body: JSON.stringify(data)
            })
          : await safeFetch('/api/patients', {
              method: 'POST',
              body: JSON.stringify(data)
            });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Error saving patient' }));
          throw new Error(error.error || error.message || 'Error saving patient');
        }

        const result = await response.json();

        if (editingPatientId) {
          showToast('Patient record updated successfully!', 'success');
          editingPatientId = null;
          const submitBtn = patientForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-id-card"></i> Register Patient & Issue NFC Card';
        } else {
          showToast(`Patient ${result.first_name} ${result.last_name} enrolled & NFC Card ${result.card_uid} linked!`, 'success');
          showCardSummaryModal(result);
        }

        patientForm.reset();
        await loadPatients(result.id);
        try { localStorage.setItem('mediscan_patients_updated', Date.now()); } catch (e) {}
      } catch (err) {
        showToast(err.message || 'Error saving patient', 'error');
      }
    });
  }

  // ── Card Summary Modal ─────────────────────────────────────────────
  function showCardSummaryModal(patient) {
    if (!cardSummaryModal) return;
    if (summaryCardUID) summaryCardUID.textContent = patient.card_uid;
    if (summaryPatientName) summaryPatientName.textContent = `${patient.first_name} ${patient.last_name}`;
    if (summaryPatientMeta) summaryPatientMeta.textContent = `Age: ${patient.age || '—'} | Gender: ${patient.gender || '—'} | Blood: ${patient.blood_group || '—'}`;
    if (summaryPatientPhone) summaryPatientPhone.textContent = `Contact: ${patient.contact_phone || '—'}`;

    cardSummaryModal.classList.add('active');
    cardSummaryModal.style.display = 'flex';
  }

  function hideCardSummaryModal() {
    if (cardSummaryModal) {
      cardSummaryModal.classList.remove('active');
      cardSummaryModal.style.display = 'none';
    }
  }

  if (btnCloseCardSummary) btnCloseCardSummary.addEventListener('click', hideCardSummaryModal);
  if (btnCloseSummary) btnCloseSummary.addEventListener('click', hideCardSummaryModal);

  // ── Load Patient List ──────────────────────────────────────────────
  async function loadPatients(selectedId = null) {
    if (!patientTableBody && !apptPatient) return;
    try {
      const response = await safeFetch('/api/patients');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      allPatientsCache = await response.json();
      renderPatientList(allPatientsCache);
      populatePatientDropdown(allPatientsCache, selectedId);
    } catch (err) {
      console.error('Failed to load patients:', err);
      if (patientTableBody) patientTableBody.innerHTML = `<tr><td colspan="7">Error loading patients</td></tr>`;
    }
  }

  function renderPatientList(patients) {
    if (!patientTableBody) return;
    if (!patients || patients.length === 0) {
      patientTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7" style="text-align: center; padding: 32px 16px; color: #64748B;">
            <div style="font-size: 28px; color: #0077B6; margin-bottom: 8px;"><i class="fas fa-id-card"></i></div>
            <strong style="font-size: 15px; color: #1E293B; display: block; margin-bottom: 4px;">No Patients Registered Yet</strong>
            <span>Fill out the form above, scan an NFC smart card, and click Register Patient to enroll your first patient.</span>
          </td>
        </tr>
      `;
      return;
    }

    patientTableBody.innerHTML = patients.map(p => `
      <tr class="table-capsule-row">
        <td>
          <span class="nfc-chip-pill">
            <i class="fas fa-wifi" style="transform: rotate(90deg); font-size: 11px;"></i> ${p.card_uid}
          </span>
        </td>
        <td><strong style="color: #0F172A; font-size: 14px;">${p.first_name} ${p.last_name}</strong></td>
        <td><span style="font-weight: 600;">${p.age ?? '—'}</span></td>
        <td>${p.gender || '—'}</td>
        <td style="font-weight: 500;">${p.contact_phone || '—'}</td>
        <td style="color: #64748B; font-size: 12.5px;">${formatDate(p.registered_at)}</td>
        <td>
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button type="button" class="btn btn-sm btn-outline btn-view-patient" data-uid="${p.card_uid}" title="View Health Record" style="padding: 4px 10px; font-size: 11px; border-radius: 14px;">
              <i class="fas fa-eye" style="color: #0084FF;"></i> View
            </button>
            <button type="button" class="btn btn-sm btn-outline btn-edit-patient" data-id="${p.id}" data-uid="${p.card_uid}" title="Edit Information" style="padding: 4px 10px; font-size: 11px; border-radius: 14px;">
              <i class="fas fa-edit" style="color: #F59E0B;"></i> Edit
            </button>
            <button type="button" class="btn btn-sm btn-danger-outline btn-delete-patient" data-id="${p.id}" data-name="${p.first_name} ${p.last_name}" title="Remove Patient" style="padding: 4px 8px; font-size: 11px; border-radius: 14px;">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    // Event listeners
    patientTableBody.querySelectorAll('.btn-view-patient').forEach(btn => {
      btn.addEventListener('click', () => viewPatientDetails(btn.dataset.uid));
    });

    patientTableBody.querySelectorAll('.btn-edit-patient').forEach(btn => {
      btn.addEventListener('click', () => editPatient(btn.dataset.id, btn.dataset.uid));
    });

    patientTableBody.querySelectorAll('.btn-delete-patient').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;

        const confirmed = typeof showConfirmDialog === 'function'
          ? await showConfirmDialog({
              title: 'Delete Patient Record',
              message: `Are you sure you want to remove patient <strong>"${escapeHtml(name)}"</strong> from the system? This will delete associated clinical files and NFC card links.`,
              confirmText: 'Delete Record',
              cancelText: 'Keep Patient',
              type: 'danger',
              icon: 'fas fa-trash-alt'
            })
          : confirm(`Are you sure you want to remove patient "${name}" from the system? This will delete associated records.`);

        if (!confirmed) {
          return;
        }
        try {
          const response = await safeFetch(`/api/patients/${id}`, {
            method: 'DELETE'
          });
          if (!response.ok) {
            throw new Error('Error deleting patient');
          }
          showToast(`Patient ${name} removed.`, 'info');
          loadPatients();
        } catch (err) {
          showToast(err.message || 'Error deleting patient', 'error');
        }
      });
    });
  }

  // ── Search Patients ────────────────────────────────────────────────
  if (patientSearch) {
    patientSearch.addEventListener('input', () => {
      const q = patientSearch.value.trim().toLowerCase();
      if (!q) {
        renderPatientList(allPatientsCache);
        return;
      }
      const filtered = allPatientsCache.filter(p =>
        (p.first_name && p.first_name.toLowerCase().includes(q)) ||
        (p.last_name && p.last_name.toLowerCase().includes(q)) ||
        (p.card_uid && p.card_uid.toLowerCase().includes(q)) ||
        (p.contact_phone && p.contact_phone.toLowerCase().includes(q))
      );
      renderPatientList(filtered);
    });
  }

  // ── View Patient Details in Modal ─────────────────────────────────
  async function viewPatientDetails(cardUID) {
    if (!patientDetailModal || !patientDetailContent) return;

    try {
      const response = await safeFetch(`/api/patients/card/${encodeURIComponent(cardUID)}`);
      if (!response.ok) {
        throw new Error('Error loading patient details');
      }
      const data = await response.json();
      const p = data.patient || data;
      const visits = data.visits || [];
      const labReports = data.lab_reports || data.labReports || [];

      patientDetailContent.innerHTML = `
        <div style="padding: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #E0E0E0; padding-bottom: 12px; margin-bottom: 16px;">
            <div>
              <h2 style="margin: 0; color: #0077B6;">${p.first_name} ${p.last_name}</h2>
              <div style="color: #666; font-size: 14px; margin-top: 4px;">Registered: ${formatDateTime(p.registered_at)}</div>
            </div>
            <span style="font-family: monospace; font-size: 16px; font-weight: 700; color: #0077B6; background: #E0F2FE; padding: 6px 14px; border-radius: 6px; border: 1px solid #90E0EF;">
              💳 ${p.card_uid}
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; background: #F8F9FA; padding: 14px; border-radius: 8px;">
            <div><strong>Age:</strong> ${p.age ? p.age + ' yrs' : '—'}</div>
            <div><strong>Gender:</strong> ${p.gender || '—'}</div>
            <div><strong>Blood Group:</strong> <span style="color:#e74c3c; font-weight:700;">${p.blood_group || '—'}</span></div>
            <div><strong>Phone:</strong> ${p.contact_phone || '—'}</div>
            <div><strong>Email:</strong> ${p.contact_email || '—'}</div>
            <div><strong>Insurance ID:</strong> ${p.insurance_id || '—'}</div>
            <div style="grid-column: 1 / -1;"><strong>Address:</strong> ${p.address || '—'}</div>
            <div style="grid-column: 1 / -1;"><strong>Emergency Contact:</strong> ${p.emergency_contact_name || '—'} (${p.emergency_contact_relation || 'Relation'}) &bull; ${p.emergency_contact_phone || '—'}</div>
          </div>

          ${p.allergies ? `
            <div style="background: #FFF3CD; border: 1px solid #FFEEBA; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; color: #856404;">
              <strong>⚠️ Allergies:</strong> ${p.allergies}
            </div>` : ''}

          ${p.chronic_conditions ? `
            <div style="background: #F8D7DA; border: 1px solid #F5C6CB; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #721C24;">
              <strong>🏥 Chronic Conditions:</strong> ${p.chronic_conditions}
            </div>` : ''}

          <h4 style="margin: 16px 0 8px;"><i class="fas fa-history"></i> Medical & Visit History (${visits.length})</h4>
          ${visits.length === 0 ? '<p style="color:#888;">No recorded visits yet.</p>' : `
            <div style="max-height: 220px; overflow-y: auto;">
              ${visits.map(v => `
                <div style="border: 1px solid #E0E0E0; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; font-weight: 600;">
                    <span>${formatDate(v.visit_date)} &bull; ${v.doctor_name || 'Doctor'}</span>
                    <span class="badge ${v.status === 'completed' ? 'badge-success' : 'badge_info'}">${v.status || 'completed'}</span>
                  </div>
                  <div style="font-size: 13px; margin-top: 4px; color: #444;">
                    <strong>Diagnosis:</strong> ${v.diagnosis || 'General checkup'} | <strong>Symptoms:</strong> ${v.symptoms || 'None recorded'}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      `;

      patientDetailModal.classList.add('active');
      patientDetailModal.style.display = 'flex';
    } catch (err) {
      showToast('Error loading patient details', 'error');
    }
  }

  function hidePatientDetailModal() {
    if (patientDetailModal) {
      patientDetailModal.classList.remove('active');
      patientDetailModal.style.display = 'none';
    }
  }

  if (btnClosePatientDetail) btnClosePatientDetail.addEventListener('click', hidePatientDetailModal);
  if (btnCloseDetail) btnCloseDetail.addEventListener('click', hidePatientDetailModal);

  // ── Edit Patient ───────────────────────────────────────────────────
  async function editPatient(id, cardUID) {
    try {
      const response = await safeFetch(`/api/patients/card/${encodeURIComponent(cardUID)}`);
      if (!response.ok) {
        throw new Error('Error loading patient for edit');
      }
      const data = await response.json();
      const p = data.patient || data;

      editingPatientId = p.id;

      // Populate form fields
      const setValue = (name, val) => {
        const el = patientForm.querySelector(`[name="${name}"]`);
        if (el && val != null) el.value = val;
      };

      setValue('first_name', p.first_name);
      setValue('last_name', p.last_name);
      setValue('date_of_birth', p.date_of_birth);
      setValue('age', p.age);
      setValue('gender', p.gender);
      setValue('blood_group', p.blood_group);
      setValue('contact_phone', p.contact_phone);
      setValue('contact_email', p.contact_email);
      setValue('emergency_contact_name', p.emergency_contact_name);
      setValue('emergency_contact_phone', p.emergency_contact_phone);
      setValue('emergency_contact_relation', p.emergency_contact_relation);
      setValue('address', p.address);
      setValue('allergies', p.allergies);
      setValue('chronic_conditions', p.chronic_conditions);
      setValue('insurance_id', p.insurance_id);
      setValue('card_uid', p.card_uid);

      const submitBtn = patientForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes to Patient';

      patientForm.scrollIntoView({ behavior: 'smooth' });
      showToast(`Editing ${p.first_name} ${p.last_name}. Update fields and save.`, 'info');
    } catch (err) {
      showToast('Error loading patient for edit', 'error');
    }
  }

  // ── Populate Patients Dropdown for Appointment Scheduling ─────────
  function populatePatientDropdown(patients, selectedId = null) {
    const el = document.getElementById('apptPatient') || apptPatient;
    if (!el) return;
    const currentVal = selectedId || el.value;
    el.innerHTML = '<option value="">Select Patient…</option>' +
      (patients || []).map(p => {
        const name = (p.first_name || p.last_name) ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : `Patient #${p.id}`;
        return `<option value="${p.id}">${name} (${p.card_uid || 'No Card'})</option>`;
      }).join('');
    if (currentVal && Array.from(el.options).some(o => o.value == currentVal)) {
      el.value = currentVal;
    }
  }

  // ── Appointment Scheduling ─────────────────────────────────────────
  if (apptDate) {
    // Default to today's date
    apptDate.value = new Date().toISOString().split('T')[0];
  }

  if (apptPatient) {
    apptPatient.addEventListener('focus', () => loadPatients());
  }

  if (apptDoctor) {
    apptDoctor.addEventListener('focus', () => loadDoctors());
  }

  if (appointmentForm) {
    appointmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(appointmentForm);
      const data = Object.fromEntries(formData.entries());

      if (!data.patient_id) {
        showToast('Please select a patient', 'error');
        return;
      }
      data.patient_id = parseInt(data.patient_id);

      try {
        const response = await safeFetch('/api/appointments', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Error scheduling appointment' }));
          throw new Error(error.message || 'Error scheduling appointment');
        }
        showToast('Appointment successfully scheduled!', 'success');
        appointmentForm.reset();
        if (apptDate) apptDate.value = new Date().toISOString().split('T')[0];
      } catch (err) {
        showToast(err.message || 'Error scheduling appointment', 'error');
      }
    });
  }

  // ── Doctors Management ─────────────────────────────────────────────
  async function loadDoctors() {
    try {
      const response = await safeFetch('/api/doctors');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const doctors = await response.json();

      // Populate doctor dropdown in appointments
      const elDoc = document.getElementById('apptDoctor') || apptDoctor;
      if (elDoc) {
        const prev = elDoc.value;
        elDoc.innerHTML = '<option value="">Select Doctor…</option>' +
          doctors.map(d => `<option value="${d.name}">${d.name} — ${d.department || ''}</option>`).join('');
        if (prev && Array.from(elDoc.options).some(o => o.value === prev)) {
          elDoc.value = prev;
        }
      }

      // Populate doctor table
      if (doctorTableBody) {
        if (!doctors || doctors.length === 0) {
          doctorTableBody.innerHTML = `
            <tr class="empty-row">
              <td colspan="4"><i class="fas fa-inbox"></i> No doctors added yet</td>
            </tr>
          `;
          return;
        }

        doctorTableBody.innerHTML = doctors.map(d => `
          <tr class="table-capsule-row">
            <td><strong style="color: #0F172A;">${escapeHtml(d.name)}</strong></td>
            <td><span style="font-weight: 600; color: #0084FF;">${escapeHtml(d.department || '—')}</span></td>
            <td>${escapeHtml(d.specialization || '—')}</td>
            <td>
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button type="button" class="btn btn-sm btn-outline btn-edit-doctor" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-dept="${escapeHtml(d.department || '')}" data-spec="${escapeHtml(d.specialization || '')}" title="Edit Physician" style="padding: 4px 10px; font-size: 11px; border-radius: 14px;">
                  <i class="fas fa-edit" style="color: #F59E0B;"></i> Edit
                </button>
                <button type="button" class="btn btn-sm btn-danger-outline btn-delete-doctor" data-id="${d.id}" data-name="${escapeHtml(d.name)}" title="Remove Physician" style="padding: 4px 8px; font-size: 11px; border-radius: 14px;">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('');

        // Attach event listeners to Edit and Delete buttons
        doctorTableBody.querySelectorAll('.btn-edit-doctor').forEach(btn => {
          btn.addEventListener('click', () => {
            editDoctor(btn.dataset.id, btn.dataset.name, btn.dataset.dept, btn.dataset.spec);
          });
        });

        doctorTableBody.querySelectorAll('.btn-delete-doctor').forEach(btn => {
          btn.addEventListener('click', () => {
            deleteDoctor(btn.dataset.id, btn.dataset.name);
          });
        });
      }
    } catch (err) {
      console.error('Failed to load doctors:', err);
    }
  }

  // ── Edit & Delete Doctor Handlers ──────────────────────────────────
  function editDoctor(id, name, dept, spec) {
    editingDoctorId = id;
    if (docName) docName.value = name || '';
    if (docDepartment) docDepartment.value = dept || '';
    if (docSpecialization) docSpecialization.value = spec || '';

    if (btnAddDoctor) {
      btnAddDoctor.innerHTML = '<i class="fas fa-save"></i> Save Changes to Physician';
    }
    if (btnCancelEditDoctor) {
      btnCancelEditDoctor.style.display = 'inline-flex';
    }

    if (doctorForm) {
      doctorForm.scrollIntoView({ behavior: 'smooth' });
    }
    if (docName) {
      docName.focus();
    }
    showToast(`Editing ${name}. Update fields and click Save.`, 'info');
  }

  function cancelDoctorEdit() {
    editingDoctorId = null;
    if (doctorForm) doctorForm.reset();
    if (btnAddDoctor) {
      btnAddDoctor.innerHTML = '<i class="fas fa-plus"></i> Add Physician';
    }
    if (btnCancelEditDoctor) {
      btnCancelEditDoctor.style.display = 'none';
    }
  }

  if (btnCancelEditDoctor) {
    btnCancelEditDoctor.addEventListener('click', cancelDoctorEdit);
  }

  async function deleteDoctor(id, name) {
    const confirmed = typeof showConfirmDialog === 'function'
      ? await showConfirmDialog({
          title: 'Remove Attending Physician',
          message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong> from the active physician roster?`,
          confirmText: 'Remove Physician',
          cancelText: 'Keep on Roster',
          type: 'danger',
          icon: 'fas fa-user-minus'
        })
      : confirm(`Are you sure you want to remove "${name}" from the physician roster?`);

    if (!confirmed) {
      return;
    }

    try {
      const response = await safeFetch(`/api/doctors/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Error deleting doctor' }));
        throw new Error(error.message || 'Error deleting doctor');
      }

      showToast(`Dr. ${name} removed from physician roster.`, 'info');
      if (editingDoctorId === id) {
        cancelDoctorEdit();
      }
      await loadDoctors();
      try { localStorage.setItem('mediscan_doctors_updated', Date.now()); } catch (e) {}
    } catch (err) {
      showToast(err.message || 'Error deleting doctor', 'error');
    }
  }

  if (doctorForm) {
    doctorForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(doctorForm);
      const data = Object.fromEntries(formData.entries());

      if (!data.name || !data.name.trim()) {
        showToast('Doctor name is required', 'error');
        return;
      }

      try {
        const response = editingDoctorId
          ? await safeFetch(`/api/doctors/${editingDoctorId}`, {
              method: 'PUT',
              body: JSON.stringify(data)
            })
          : await safeFetch('/api/doctors', {
              method: 'POST',
              body: JSON.stringify(data)
            });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Error saving doctor' }));
          throw new Error(error.error || error.message || 'Error saving doctor');
        }

        if (editingDoctorId) {
          showToast(`Physician ${data.name} updated successfully!`, 'success');
          cancelDoctorEdit();
        } else {
          showToast(`Dr. ${data.name} added!`, 'success');
          doctorForm.reset();
        }

        await loadDoctors();
        try { localStorage.setItem('mediscan_doctors_updated', Date.now()); } catch (e) {}
      } catch (err) {
        showToast(err.message || 'Error saving doctor', 'error');
      }
    });
  }

  // Cross-tab real-time sync when doctors or patients are added
  window.addEventListener('storage', (e) => {
    if (e.key === 'mediscan_doctors_updated') {
      loadDoctors();
    }
    if (e.key === 'mediscan_patients_updated') {
      loadPatients();
    }
    if (e.key === 'mediscan_departments_updated') {
      loadDepartments();
    }
  });

  // ── Hospital Departments Management ────────────────────────────────
  async function loadDepartments() {
    try {
      const response = await safeFetch('/api/departments');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      allDepartmentsCache = await response.json();

      // 1. Populate #apptDepartment dropdown in Appointment Form
      if (apptDepartment) {
        const prevDept = apptDepartment.value;
        if (!allDepartmentsCache || allDepartmentsCache.length === 0) {
          apptDepartment.innerHTML = '<option value="">No departments configured</option>';
        } else {
          apptDepartment.innerHTML = allDepartmentsCache.map(d =>
            `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`
          ).join('');
          if (prevDept && Array.from(apptDepartment.options).some(o => o.value === prevDept)) {
            apptDepartment.value = prevDept;
          }
        }
      }

      // 2. Populate #hospitalDeptList datalist for Doctor Department autocomplete
      if (hospitalDeptList) {
        hospitalDeptList.innerHTML = allDepartmentsCache.map(d =>
          `<option value="${escapeHtml(d.name)}">`
        ).join('');
      }

      // 3. Update count badge in Department card
      if (deptCountBadge) {
        deptCountBadge.textContent = `${allDepartmentsCache.length} Active Departments`;
      }

      // 4. Render #departmentTableBody
      if (departmentTableBody) {
        if (!allDepartmentsCache || allDepartmentsCache.length === 0) {
          departmentTableBody.innerHTML = `
            <tr class="empty-row">
              <td colspan="4" style="text-align: center; padding: 24px; color: #64748B;">
                <i class="fas fa-sitemap" style="font-size: 24px; color: #9333EA; margin-bottom: 8px; display: block;"></i>
                <strong>No Hospital Departments Configured</strong><br>
                <span>Add your facility's first medical department using the form above.</span>
              </td>
            </tr>
          `;
          return;
        }

        departmentTableBody.innerHTML = allDepartmentsCache.map(d => `
          <tr class="table-capsule-row">
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: #9333EA; display: inline-block;"></span>
                <strong style="color: #0F172A; font-size: 14px;">${escapeHtml(d.name)}</strong>
              </div>
            </td>
            <td><span style="color: #475569; font-size: 13px;">${escapeHtml(d.description || '—')}</span></td>
            <td style="text-align: center;">
              <span class="badge ${d.doctor_count > 0 ? 'badge-light-blue' : 'badge-slate'}" style="font-size: 11px;">
                ${d.doctor_count} ${d.doctor_count === 1 ? 'Doctor' : 'Doctors'}
              </span>
            </td>
            <td>
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button type="button" class="btn btn-sm btn-outline btn-edit-dept" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-desc="${escapeHtml(d.description || '')}" title="Edit Department" style="padding: 4px 10px; font-size: 11px; border-radius: 14px;">
                  <i class="fas fa-edit" style="color: #F59E0B;"></i> Edit
                </button>
                <button type="button" class="btn btn-sm btn-danger-outline btn-delete-dept" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-count="${d.doctor_count}" title="Remove Department" style="padding: 4px 8px; font-size: 11px; border-radius: 14px;">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('');

        // Attach event listeners to Edit and Delete buttons
        departmentTableBody.querySelectorAll('.btn-edit-dept').forEach(btn => {
          btn.addEventListener('click', () => {
            editDepartment(btn.dataset.id, btn.dataset.name, btn.dataset.desc);
          });
        });

        departmentTableBody.querySelectorAll('.btn-delete-dept').forEach(btn => {
          btn.addEventListener('click', () => {
            deleteDepartment(btn.dataset.id, btn.dataset.name, parseInt(btn.dataset.count) || 0);
          });
        });
      }
    } catch (err) {
      console.error('Failed to load departments:', err);
      if (departmentTableBody) {
        departmentTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #EF4444; padding: 18px;">Failed to load departments</td></tr>`;
      }
    }
  }

  // ── Edit Department ────────────────────────────────────────────────
  function editDepartment(id, name, desc) {
    editingDepartmentId = id;
    if (deptName) deptName.value = name || '';
    if (deptDescription) deptDescription.value = desc || '';

    if (btnAddDepartment) {
      btnAddDepartment.innerHTML = '<i class="fas fa-save"></i> Save Changes to Department';
    }
    if (btnCancelEditDept) {
      btnCancelEditDept.style.display = 'inline-flex';
    }

    if (departmentSection) {
      departmentSection.scrollIntoView({ behavior: 'smooth' });
    }
    if (deptName) {
      deptName.focus();
    }
    showToast(`Editing "${name}" department. Update details and click Save.`, 'info');
  }

  function cancelDepartmentEdit() {
    editingDepartmentId = null;
    if (departmentForm) departmentForm.reset();
    if (btnAddDepartment) {
      btnAddDepartment.innerHTML = '<i class="fas fa-plus"></i> Add Department';
    }
    if (btnCancelEditDept) {
      btnCancelEditDept.style.display = 'none';
    }
  }

  if (btnCancelEditDept) {
    btnCancelEditDept.addEventListener('click', cancelDepartmentEdit);
  }

  // ── Delete Department ──────────────────────────────────────────────
  async function deleteDepartment(id, name, count) {
    const msg = count > 0
      ? `Department <strong>"${escapeHtml(name)}"</strong> currently has <strong>${count} assigned physician(s)</strong>.<br><br>Are you sure you want to remove it from your hospital's department catalog?`
      : `Are you sure you want to remove <strong>"${escapeHtml(name)}"</strong> from your hospital's department catalog?`;

    const confirmed = typeof showConfirmDialog === 'function'
      ? await showConfirmDialog({
          title: 'Delete Hospital Department',
          message: msg,
          confirmText: 'Delete Department',
          cancelText: 'Keep Department',
          type: 'danger',
          icon: 'fas fa-sitemap'
        })
      : confirm(`Are you sure you want to remove department "${name}"?`);

    if (!confirmed) {
      return;
    }

    try {
      const response = await safeFetch(`/api/departments/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Error deleting department' }));
        throw new Error(error.message || 'Error deleting department');
      }

      showToast(`Department "${name}" removed.`, 'info');
      if (editingDepartmentId === id) {
        cancelDepartmentEdit();
      }
      await loadDepartments();
      await loadDoctors();
      try { localStorage.setItem('mediscan_departments_updated', Date.now()); } catch (e) {}
    } catch (err) {
      showToast(err.message || 'Error deleting department', 'error');
    }
  }

  // ── Department Form Submit ─────────────────────────────────────────
  if (departmentForm) {
    departmentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(departmentForm);
      const data = Object.fromEntries(formData.entries());

      if (!data.name || !data.name.trim()) {
        showToast('Department name is required', 'error');
        if (deptName) deptName.focus();
        return;
      }

      try {
        const response = editingDepartmentId
          ? await safeFetch(`/api/departments/${editingDepartmentId}`, {
              method: 'PUT',
              body: JSON.stringify(data)
            })
          : await safeFetch('/api/departments', {
              method: 'POST',
              body: JSON.stringify(data)
            });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Error saving department' }));
          throw new Error(error.message || 'Error saving department');
        }

        if (editingDepartmentId) {
          showToast(`Department "${data.name}" updated successfully!`, 'success');
          cancelDepartmentEdit();
        } else {
          showToast(`Department "${data.name}" added to hospital catalog!`, 'success');
          departmentForm.reset();
        }

        await loadDepartments();
        await loadDoctors();
        try { localStorage.setItem('mediscan_departments_updated', Date.now()); } catch (e) {}
      } catch (err) {
        showToast(err.message || 'Error saving department', 'error');
      }
    });
  }

  if (apptDepartment) {
    apptDepartment.addEventListener('focus', loadDepartments);
  }

  // Initial load
  loadPatients();
  loadDoctors();
  loadDepartments();

  // Periodic polling so changes made across tabs sync automatically
  setInterval(loadPatients, 8000);
  setInterval(loadDoctors, 8000);
  setInterval(loadDepartments, 12000);
}

// Ensure execution whether DOM is already ready or loading
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}