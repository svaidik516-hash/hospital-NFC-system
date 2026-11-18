/**
 * Express server for NFC Hospital Patient Management System
 * Serves the API and static frontend files with full authentication & authorization.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Initialize Authentication & Database ──────────────────────────────────────────
let isSystemInitialized = false;
let initPromise = null;

async function ensureSystemInitialized() {
  if (isSystemInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      await auth.initAuth();
      await db.initDB();
      isSystemInitialized = true;
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

// ─── Security Middleware ──────────────────────────────────────────────────────────

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'deny' },
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // stricter limit for auth endpoints
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);

// ─── CORS & Body Parser ───────────────────────────────────────────────────────────

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, same-origin) or any localhost/127.0.0.1 workstation origin
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Handle malformed JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  next(err);
});

// Ensure database & auth system are ready before processing ANY request (critical for Vercel serverless cold starts)
app.use(async (req, res, next) => {
  try {
    await ensureSystemInitialized();
    next();
  } catch (err) {
    console.error('System initialization error:', err);
    res.status(500).json({
      error: 'Database and system initialization failed',
      details: err.message
    });
  }
});

// ─── Static Files ─────────────────────────────────────────────────────────────────

const publicDir = path.join(__dirname, 'public');
try {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in serverless environments
}

app.use(express.static(publicDir, {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ─── Helper: Decrypt Permission ───────────────────────────────────────────────────

function canDecryptData(user) {
  if (!user) return true;
  // Admin and doctors can decrypt sensitive patient data
  return user.role === auth.ROLES.ADMIN || user.role === auth.ROLES.DOCTOR;
}

function getDecryptPermission(req) {
  return req.user ? canDecryptData(req.user) : true;
}

// ─── Audit Log Wrapper ────────────────────────────────────────────────────────────

function auditMiddleware(action, getDetails) {
  return (req, res, next) => {
    const originalSend = res.send;
    res.send = function (body) {
      try {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          const details = getDetails ? getDetails(req, res, body) : {};
          auth.auditLog(action, req.user?.userId, { ...details, ip: req.ip, method: req.method, path: req.path });
        }
      } catch (err) {
        console.warn('Audit middleware error:', err.message);
      }
      return originalSend.call(this, body);
    };
    next();
  };
}

// ─── Auth Endpoints (PUBLIC - no requireAuth) ─────────────────────────────────────

// POST /api/auth/login - email/username + password -> accessToken, refreshToken, user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const loginId = email || username;
    console.log('Login attempt:', { loginId, hasPassword: !!password });
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const user = await auth.authenticateUser(loginId.toLowerCase(), password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = auth.generateTokens(user);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('POST /api/auth/login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh - refreshToken -> new accessToken
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const tokens = await auth.refreshAccessToken(refreshToken);
    if (!tokens) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    res.json(tokens);
  } catch (err) {
    console.error('POST /api/auth/refresh error:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// GET /api/auth/me - current user profile
app.get('/api/auth/me', auth.requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout - revoke refresh token
app.post('/api/auth/logout', auth.requireAuth(), (req, res) => {
  // In a production system, you'd store revoked refresh tokens in a database
  // For now, we just log the logout
  auth.auditLog('LOGOUT', req.user.userId, { ip: req.ip });
  res.json({ success: true, message: 'Logged out successfully' });
});

// ─── PROTECT ALL /api ROUTES EXCEPT /api/auth/* ───────────────────────────────────

app.use('/api', (req, res, next) => {
  // Skip auth for /api/auth/* routes
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  // Apply requireAuth middleware
  return auth.requireAuth()(req, res, next);
});

// ─── ROLE-BASED PERMISSION MIDDLEWARE ─────────────────────────────────────────────

const requireAdmin = auth.requireRole([auth.ROLES.ADMIN]);
const requireDoctor = auth.requireRole([auth.ROLES.ADMIN, auth.ROLES.DOCTOR]);
const requireReception = auth.requireRole([auth.ROLES.ADMIN, auth.ROLES.DOCTOR, auth.ROLES.RECEPTION]);
const requireDoctorOrReception = auth.requireRole([auth.ROLES.ADMIN, auth.ROLES.DOCTOR, auth.ROLES.RECEPTION]);

// ─── PATIENT ROUTES ───────────────────────────────────────────────────────────────

// GET /api/patients - list all (Admin: decrypted, Doctor: decrypted, Reception: encrypted)
app.get('/api/patients', requireDoctorOrReception, auditMiddleware('PATIENTS_LIST', (req) => ({ canDecrypt: getDecryptPermission(req) })), async (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const patients = await db.getAllPatients(canDecrypt);
    res.json(patients);
  } catch (err) {
    console.error('GET /api/patients error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve patients' });
  }
});

// GET /api/patients/search?q= - search (no decryption needed)
app.get('/api/patients/search', requireDoctorOrReception, auditMiddleware('PATIENTS_SEARCH'), (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }
    const patients = db.searchPatients(query);
    res.json(patients);
  } catch (err) {
    console.error('GET /api/patients/search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/patients/card/:uid - full record by NFC card UID (decrypted for admin/doctor)
app.get('/api/patients/card/:uid', requireDoctorOrReception, auditMiddleware('PATIENT_RECORD_ACCESS', (req) => ({ cardUid: req.params.uid, canDecrypt: getDecryptPermission(req) })), async (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const record = await db.getFullPatientRecord(req.params.uid, canDecrypt);
    if (!record) {
      return res.status(404).json({ error: 'Patient not found with that card UID' });
    }
    res.json(record);
  } catch (err) {
    console.error('GET /api/patients/card/:uid error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve patient record' });
  }
});

// POST /api/patients - create patient (reception, admin)
app.post('/api/patients', requireReception, auditMiddleware('PATIENT_CREATED', (req, res) => ({ patientId: res.locals?.patientId || 'unknown' })), async (req, res) => {
  try {
    const data = req.body;
    if (!data.first_name || !data.last_name) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    if (!data.card_uid || !data.card_uid.trim()) {
      return res.status(400).json({ error: 'NFC Card UID is required. Please tap/scan the patient physical NFC card or enter the UID.' });
    }
    data.card_uid = data.card_uid.trim();
    const patient = await db.createPatient(data);
    res.locals.patientId = patient.id;
    const canDecrypt = getDecryptPermission(req);
    res.status(201).json(db.maybeDecryptPatient ? db.maybeDecryptPatient(patient, canDecrypt) : patient);
  } catch (err) {
    console.error('POST /api/patients error:', err.message);
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A patient with this NFC Card UID already exists.' });
    }
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// PUT /api/patients/:id - update patient (admin only)
app.put('/api/patients/:id', requireAdmin, auditMiddleware('PATIENT_UPDATED', (req) => ({ patientId: req.params.id })), async (req, res) => {
  try {
    const patient = await db.updatePatient(parseInt(req.params.id), req.body);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(patient);
  } catch (err) {
    console.error('PUT /api/patients/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

// DELETE /api/patients/:id - delete patient (admin only)
app.delete('/api/patients/:id', requireAdmin, auditMiddleware('PATIENT_DELETED', (req) => ({ patientId: req.params.id })), async (req, res) => {
  try {
    const success = await db.deletePatient(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json({ success: true, message: 'Patient removed from directory' });
  } catch (err) {
    console.error('DELETE /api/patients/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
});

// ─── VISIT ROUTES ────────────────────────────────────────────────────────────────

// POST /api/visits - create visit (doctor, admin)
app.post('/api/visits', requireDoctor, auditMiddleware('VISIT_CREATED', (req, res) => ({ visitId: res.locals?.visitId, patientId: req.body.patient_id })), (req, res) => {
  try {
    const data = req.body;
    if (!data.patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    const visit = db.createVisit(data);
    res.locals.visitId = visit.id;
    res.status(201).json(visit);
  } catch (err) {
    console.error('POST /api/visits error:', err.message);
    res.status(500).json({ error: 'Failed to create visit' });
  }
});

// PUT /api/visits/:id - update visit (doctor, admin)
app.put('/api/visits/:id', requireDoctor, auditMiddleware('VISIT_UPDATED', (req) => ({ visitId: req.params.id })), (req, res) => {
  try {
    const visit = db.updateVisit(parseInt(req.params.id), req.body);
    if (!visit) {
      return res.status(404).json({ error: 'Visit not found' });
    }
    res.json(visit);
  } catch (err) {
    console.error('PUT /api/visits/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update visit' });
  }
});

// GET /api/visits/patient/:patientId - get visits for patient (doctor: decrypted, reception: encrypted)
app.get('/api/visits/patient/:patientId', requireDoctorOrReception, auditMiddleware('VISITS_LIST', (req) => ({ patientId: req.params.patientId, canDecrypt: getDecryptPermission(req) })), (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const visits = db.getVisitsByPatient(parseInt(req.params.patientId), canDecrypt);
    res.json(visits);
  } catch (err) {
    console.error('GET /api/visits/patient/:patientId error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve visits' });
  }
});

// ─── PRESCRIPTION ROUTES ──────────────────────────────────────────────────────────

// POST /api/prescriptions - create prescription (doctor, admin)
app.post('/api/prescriptions', requireDoctor, auditMiddleware('PRESCRIPTION_CREATED', (req, res) => ({ prescriptionId: res.locals?.prescriptionId, patientId: req.body.patient_id })), (req, res) => {
  try {
    const data = req.body;
    if (!data.patient_id || !data.medicine_name) {
      return res.status(400).json({ error: 'patient_id and medicine_name are required' });
    }
    const prescription = db.createPrescription(data);
    res.locals.prescriptionId = prescription.id;
    const canDecrypt = getDecryptPermission(req);
    res.status(201).json(db.maybeDecryptPrescription ? db.maybeDecryptPrescription(prescription, canDecrypt) : prescription);
  } catch (err) {
    console.error('POST /api/prescriptions error:', err.message);
    res.status(500).json({ error: 'Failed to create prescription' });
  }
});

// GET /api/prescriptions/patient/:patientId - get prescriptions (doctor: decrypted, reception: encrypted)
app.get('/api/prescriptions/patient/:patientId', requireDoctorOrReception, auditMiddleware('PRESCRIPTIONS_LIST', (req) => ({ patientId: req.params.patientId, canDecrypt: getDecryptPermission(req) })), (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const prescriptions = db.getPrescriptionsByPatient(parseInt(req.params.patientId), canDecrypt);
    res.json(prescriptions);
  } catch (err) {
    console.error('GET /api/prescriptions/patient/:patientId error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve prescriptions' });
  }
});

// GET /api/prescriptions/visit/:visitId - get prescriptions for visit (doctor: decrypted, reception: encrypted)
app.get('/api/prescriptions/visit/:visitId', requireDoctorOrReception, auditMiddleware('PRESCRIPTIONS_LIST', (req) => ({ visitId: req.params.visitId, canDecrypt: getDecryptPermission(req) })), (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const prescriptions = db.getPrescriptionsByVisit(parseInt(req.params.visitId), canDecrypt);
    res.json(prescriptions);
  } catch (err) {
    console.error('GET /api/prescriptions/visit/:visitId error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve prescriptions' });
  }
});

// ─── APPOINTMENT ROUTES ───────────────────────────────────────────────────────────

// POST /api/appointments - create appointment (reception, admin)
app.post('/api/appointments', requireReception, auditMiddleware('APPOINTMENT_CREATED', (req, res) => ({ appointmentId: res.locals?.appointmentId, patientId: req.body.patient_id })), (req, res) => {
  try {
    const data = req.body;
    if (!data.patient_id || !data.appointment_date) {
      return res.status(400).json({ error: 'patient_id and appointment_date are required' });
    }
    const appointment = db.createAppointment(data);
    res.locals.appointmentId = appointment.id;
    res.status(201).json(appointment);
  } catch (err) {
    console.error('POST /api/appointments error:', err.message);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// GET /api/appointments/today - today's appointments (reception, doctor, admin)
app.get('/api/appointments/today', requireDoctorOrReception, auditMiddleware('APPOINTMENTS_TODAY'), async (req, res) => {
  try {
    const appointments = await db.getTodayAppointments();
    res.json(appointments);
  } catch (err) {
    console.error('GET /api/appointments/today error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve appointments' });
  }
});

// GET /api/appointments/date/:date - appointments by date (reception, doctor, admin)
app.get('/api/appointments/date/:date', requireDoctorOrReception, auditMiddleware('APPOINTMENTS_BY_DATE'), async (req, res) => {
  try {
    const appointments = await db.getAppointmentsByDate(req.params.date);
    res.json(appointments);
  } catch (err) {
    console.error('GET /api/appointments/date/:date error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve appointments' });
  }
});

// PUT /api/appointments/:id - update appointment (reception, admin)
app.put('/api/appointments/:id', requireReception, auditMiddleware('APPOINTMENT_UPDATED', (req) => ({ appointmentId: req.params.id })), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = db.updateAppointment(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/appointments/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// ─── CHECK-IN ROUTE (Reception) ───────────────────────────────────────────────────

// POST /api/checkin - NFC check-in: find patient by card UID, mark arrival, create visit
app.post('/api/checkin', requireReception, auditMiddleware('PATIENT_CHECKIN', (req, res) => ({ patientId: res.locals?.patientId, cardUid: req.body.card_uid, isWalkIn: res.locals?.isWalkIn })), async (req, res) => {
  try {
    const { card_uid } = req.body;
    if (!card_uid) {
      return res.status(400).json({ error: 'card_uid is required' });
    }

    const canDecrypt = getDecryptPermission(req);
    const patient = await db.getPatientByCardUID(card_uid, canDecrypt);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found with that NFC card' });
    }

    // Mark arrival (creates or updates visit too)
    const arrival = db.markArrival(patient.id);
    res.locals.patientId = patient.id;
    res.locals.isWalkIn = arrival.isWalkIn;

    res.json({
      patient: {
        id: patient.id,
        card_uid: patient.card_uid,
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        age: patient.age,
        gender: patient.gender,
        blood_group: patient.blood_group,
        contact_phone: patient.contact_phone,
        contact_email: patient.contact_email,
        allergies: patient.allergies,
        chronic_conditions: patient.chronic_conditions,
        emergency_contact_name: patient.emergency_contact_name,
        emergency_contact_phone: patient.emergency_contact_phone,
        emergency_contact_relation: patient.emergency_contact_relation,
      },
      visit: arrival.visit,
      appointment: arrival.appointment,
      isWalkIn: arrival.isWalkIn,
      appointment_status: arrival.isWalkIn ? 'walk_in' : 'arrived',
      message: `${patient.first_name} ${patient.last_name} checked in successfully`,
    });
  } catch (err) {
    console.error('POST /api/checkin error:', err.message);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// ─── LAB REPORT ROUTES ────────────────────────────────────────────────────────────

// POST /api/lab-reports - create lab report (doctor, admin)
app.post('/api/lab-reports', requireDoctor, auditMiddleware('LAB_REPORT_CREATED', (req, res) => ({ reportId: res.locals?.reportId, patientId: req.body.patient_id })), (req, res) => {
  try {
    const data = req.body;
    if (!data.patient_id || !data.test_name) {
      return res.status(400).json({ error: 'patient_id and test_name are required' });
    }
    const report = db.createLabReport(data);
    res.locals.reportId = report.id;
    res.status(201).json(report);
  } catch (err) {
    console.error('POST /api/lab-reports error:', err.message);
    res.status(500).json({ error: 'Failed to create lab report' });
  }
});

// GET /api/lab-reports/patient/:patientId - get lab reports (doctor: decrypted, reception: encrypted)
app.get('/api/lab-reports/patient/:patientId', requireDoctorOrReception, auditMiddleware('LAB_REPORTS_LIST', (req) => ({ patientId: req.params.patientId, canDecrypt: getDecryptPermission(req) })), (req, res) => {
  try {
    const canDecrypt = getDecryptPermission(req);
    const reports = db.getLabReportsByPatient(parseInt(req.params.patientId), canDecrypt);
    res.json(reports);
  } catch (err) {
    console.error('GET /api/lab-reports/patient/:patientId error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve lab reports' });
  }
});

// ─── DOCTOR ROUTES ────────────────────────────────────────────────────────────────

// GET /api/doctors - list all doctors (all authenticated)
app.get('/api/doctors', auth.requireAuth(), async (req, res) => {
  try {
    const doctors = await db.getDoctors();
    res.json(doctors);
  } catch (err) {
    console.error('GET /api/doctors error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve doctors' });
  }
});

// POST /api/doctors - add doctor (admin only)
app.post('/api/doctors', requireAdmin, auditMiddleware('DOCTOR_CREATED', (req, res) => ({ doctorId: res.locals?.doctorId })), async (req, res) => {
  try {
    const data = req.body;
    if (!data.name) {
      return res.status(400).json({ error: 'Doctor name is required' });
    }
    const doctor = await db.createDoctor(data);
    res.locals.doctorId = doctor.id;
    res.status(201).json(doctor);
  } catch (err) {
    console.error('POST /api/doctors error:', err.message);
    res.status(500).json({ error: 'Failed to create doctor' });
  }
});

// GET /api/doctors/:id - get single doctor
app.get('/api/doctors/:id', auth.requireAuth(), async (req, res) => {
  try {
    const doctor = await db.getDoctorById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json(doctor);
  } catch (err) {
    console.error('GET /api/doctors/:id error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve doctor' });
  }
});

// PUT /api/doctors/:id - update doctor (admin only)
app.put('/api/doctors/:id', requireAdmin, auditMiddleware('DOCTOR_UPDATED', (req, res) => ({ doctorId: req.params.id })), async (req, res) => {
  try {
    const data = req.body;
    if (data.name !== undefined && !data.name.trim()) {
      return res.status(400).json({ error: 'Doctor name cannot be empty' });
    }
    const existing = await db.getDoctorById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    const updated = await db.updateDoctor(req.params.id, data);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/doctors/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update doctor' });
  }
});

// DELETE /api/doctors/:id - delete doctor (admin only)
app.delete('/api/doctors/:id', requireAdmin, auditMiddleware('DOCTOR_DELETED', (req, res) => ({ doctorId: req.params.id })), async (req, res) => {
  try {
    const existing = await db.getDoctorById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    await db.deleteDoctor(req.params.id);
    res.json({ message: 'Doctor deleted successfully', id: parseInt(req.params.id) });
  } catch (err) {
    console.error('DELETE /api/doctors/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete doctor' });
  }
});

// ─── Health / Status Endpoint ──────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let cloudStatus = 'disabled';
  let cloudError = null;
  const pool = db.getPgPool();
  if (pool) {
    try {
      await pool.query('SELECT 1');
      cloudStatus = 'connected';
    } catch (err) {
      cloudStatus = 'disconnected';
      cloudError = err.message;
    }
  }
  res.json({
    status: 'ok',
    database: cloudStatus,
    cloudError,
    environment: process.env.VERCEL ? 'vercel' : 'local',
    timestamp: new Date().toISOString()
  });
});

// ─── DEPARTMENT ROUTES ────────────────────────────────────────────────────────────

// GET /api/departments - list all hospital departments
app.get('/api/departments', auth.requireAuth(), async (req, res) => {
  try {
    const departments = await db.getDepartments();
    res.json(departments);
  } catch (err) {
    console.error('GET /api/departments error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve departments' });
  }
});

// GET /api/departments/:id - get single department
app.get('/api/departments/:id', auth.requireAuth(), (req, res) => {
  try {
    const dept = db.getDepartmentById(req.params.id);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json(dept);
  } catch (err) {
    console.error('GET /api/departments/:id error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve department' });
  }
});

// POST /api/departments - add new hospital department (admin only)
app.post('/api/departments', requireAdmin, auditMiddleware('DEPARTMENT_CREATED', (req, res) => ({ departmentId: res.locals?.deptId })), (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !data.name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    const existing = db.getDepartmentByName(data.name);
    if (existing) {
      return res.status(409).json({ error: 'A department with this name already exists' });
    }
    const dept = db.createDepartment(data);
    res.locals.deptId = dept.id;
    res.status(201).json(dept);
  } catch (err) {
    console.error('POST /api/departments error:', err.message);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

// PUT /api/departments/:id - update department (admin only)
app.put('/api/departments/:id', requireAdmin, auditMiddleware('DEPARTMENT_UPDATED', (req, res) => ({ departmentId: req.params.id })), (req, res) => {
  try {
    const data = req.body;
    if (data.name !== undefined && !data.name.trim()) {
      return res.status(400).json({ error: 'Department name cannot be empty' });
    }
    const existing = db.getDepartmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (data.name && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = db.getDepartmentByName(data.name);
      if (duplicate && duplicate.id !== existing.id) {
        return res.status(409).json({ error: 'Another department with this name already exists' });
      }
    }
    const updated = db.updateDepartment(req.params.id, data);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/departments/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

// DELETE /api/departments/:id - delete department (admin only)
app.delete('/api/departments/:id', requireAdmin, auditMiddleware('DEPARTMENT_DELETED', (req, res) => ({ departmentId: req.params.id })), (req, res) => {
  try {
    const existing = db.getDepartmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }
    db.deleteDepartment(req.params.id);
    res.json({ message: 'Department deleted successfully', id: parseInt(req.params.id) });
  } catch (err) {
    console.error('DELETE /api/departments/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

// ─── FOLLOW-UP APPOINTMENT & NOTIFICATIONS (Doctor) ───────────────────────────────

// POST /api/doctor/followup-and-notify - create follow-up & send notifications (doctor, admin)
app.post('/api/doctor/followup-and-notify', requireDoctor, auditMiddleware('NOTIFICATION_SENT', (req, res) => ({
  patientId: req.body.patient_id,
  emailSent: res.locals?.emailSent,
  whatsappSent: res.locals?.whatsappSent,
  appointmentCreated: !!res.locals?.createdAppointment,
})), async (req, res) => {
  try {
    const {
      patient_id,
      visit_id,
      followup_date,
      followup_time,
      department,
      doctor_name,
      reason,
      target_email,
      target_phone,
      send_email = true,
      send_whatsapp = true,
    } = req.body;

    if (!patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }

    // Retrieve patient record - doctor can decrypt
    const canDecrypt = getDecryptPermission(req);
    const patients = await db.getAllPatients(canDecrypt);
    const patient = patients.find(p => p.id === parseInt(patient_id));
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // 1. Create Follow-Up Appointment if requested
    let createdAppointment = null;
    if (followup_date) {
      createdAppointment = db.createAppointment({
        patient_id: patient.id,
        appointment_date: followup_date,
        appointment_time: followup_time || '10:00',
        department: department || 'General Medicine',
        doctor_name: doctor_name || 'Attending Physician',
        reason: reason || 'Follow-up consultation',
        status: 'scheduled',
      });
    }

    // 2. Fetch current visit & prescriptions
    let visit = null;
    let prescriptions = [];
    if (visit_id) {
      const allVisits = db.getVisitsByPatient(patient.id, canDecrypt);
      visit = allVisits.find(v => v.id === parseInt(visit_id));
      prescriptions = db.getPrescriptionsByVisit(parseInt(visit_id), canDecrypt);
    }
    if (!prescriptions || prescriptions.length === 0) {
      prescriptions = db.getPrescriptionsByPatient(patient.id, canDecrypt).slice(0, 5);
    }

    // 3. Send Email (using notifications module)
    let emailResult = null;
    const notifications = require('./notifications');
    if (send_email) {
      const emailRecipient = target_email || patient.contact_email;
      if (emailRecipient) {
        try {
          emailResult = await notifications.sendPatientEmail({
            patient,
            doctorName: doctor_name,
            department,
            visit,
            prescriptions,
            appointment: createdAppointment,
            targetEmail: emailRecipient,
          });

          // Log in database
          const loggedEmail = db.createNotification({
            patient_id: patient.id,
            visit_id: visit ? visit.id : null,
            appointment_id: createdAppointment ? createdAppointment.id : null,
            channel: 'email',
            recipient: emailRecipient,
            subject: emailResult.subject,
            content: emailResult.htmlContent,
            status: 'sent',
          });
          emailResult.notification_id = loggedEmail.id;
          res.locals.emailSent = true;
        } catch (emailErr) {
          console.error('Email sending error:', emailErr.message);
          emailResult = { success: false, error: emailErr.message };
          res.locals.emailSent = false;
        }
      } else {
        emailResult = { success: false, error: 'No email address on file' };
        res.locals.emailSent = false;
      }
    }

    // 4. Send / Generate WhatsApp
    let whatsappResult = null;
    if (send_whatsapp) {
      const phoneRecipient = target_phone || patient.contact_phone;
      if (phoneRecipient) {
        try {
          whatsappResult = await notifications.sendPatientWhatsApp({
            patient,
            doctorName: doctor_name,
            department,
            visit,
            prescriptions,
            appointment: createdAppointment,
            targetPhone: phoneRecipient,
          });

          // Log in database
          const loggedWhatsApp = db.createNotification({
            patient_id: patient.id,
            visit_id: visit ? visit.id : null,
            appointment_id: createdAppointment ? createdAppointment.id : null,
            channel: 'whatsapp',
            recipient: phoneRecipient,
            subject: 'WhatsApp Medical Summary & Appointment',
            content: whatsappResult.text,
            status: 'sent',
          });
          whatsappResult.notification_id = loggedWhatsApp.id;
          res.locals.whatsappSent = true;
        } catch (waErr) {
          console.error('WhatsApp dispatch error:', waErr.message);
          whatsappResult = { success: false, error: waErr.message };
          res.locals.whatsappSent = false;
        }
      } else {
        whatsappResult = { success: false, error: 'No phone number on file' };
        res.locals.whatsappSent = false;
      }
    }

    res.locals.createdAppointment = createdAppointment;

    res.json({
      success: true,
      message: 'Follow-up appointment scheduled & notifications dispatched!',
      appointment: createdAppointment,
      email: emailResult,
      whatsapp: whatsappResult,
    });
  } catch (err) {
    console.error('POST /api/doctor/followup-and-notify error:', err.message);
    res.status(500).json({ error: 'Failed to process follow-up and notifications' });
  }
});

// GET /api/notifications/patient/:patientId - notification logs
app.get('/api/notifications/patient/:patientId', auth.requireAuth(), auditMiddleware('NOTIFICATIONS_LIST'), (req, res) => {
  try {
    const list = db.getNotificationsByPatient(parseInt(req.params.patientId));
    res.json(list);
  } catch (err) {
    console.error('GET /api/notifications/patient error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve notifications' });
  }
});

// GET /api/notifications/view-email/:id - view rendered HTML email
app.get('/api/notifications/view-email/:id', auth.requireAuth(), (req, res) => {
  try {
    const notif = db.getNotificationById(parseInt(req.params.id));
    if (!notif || notif.channel !== 'email') {
      return res.status(404).send('Email notification record not found');
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(notif.content);
  } catch (err) {
    console.error('GET /api/notifications/view-email error:', err.message);
    res.status(500).send('Error rendering email');
  }
});

// GET /api/visits/:visitId/pdf - download medical consultation PDF
app.get('/api/visits/:visitId/pdf', requireDoctor, auditMiddleware('PDF_DOWNLOADED', (req) => ({ visitId: req.params.visitId })), async (req, res) => {
  try {
    const visitId = parseInt(req.params.visitId);
    const canDecrypt = getDecryptPermission(req);
    const patients = await db.getAllPatients(canDecrypt);
    let targetVisit = null;
    let targetPatient = null;

    for (const p of patients) {
      const vList = db.getVisitsByPatient(p.id, canDecrypt);
      const found = vList.find(v => v.id === visitId);
      if (found) {
        targetVisit = found;
        targetPatient = p;
        break;
      }
    }

    if (!targetVisit || !targetPatient) {
      return res.status(404).send('Visit or patient record not found');
    }

    const prescriptions = db.getPrescriptionsByVisit(visitId, canDecrypt);
    const pRecord = await db.getPatientByCardUID(targetPatient.card_uid, canDecrypt);
    const appointment = (pRecord && pRecord.appointments && pRecord.appointments.length > 0) ? pRecord.appointments[0] : null;

    const notifications = require('./notifications');
    const pdfBuffer = await notifications.generateMedicalSummaryPDF({
      patient: targetPatient,
      doctorName: targetVisit.doctor_name,
      department: targetVisit.department,
      visit: targetVisit,
      prescriptions,
      appointment,
      hospitalPhone: process.env.HOSPITAL_PHONE,
      senderEmail: process.env.GMAIL_USER || process.env.SMTP_USER || 'info@mediscan-nfc.hospital',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Prescription_${targetPatient.card_uid}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('GET /api/visits/:visitId/pdf error:', err.message);
    res.status(500).send('Failed to generate PDF document');
  }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────────

// GET /api/dashboard/stats - dashboard statistics
app.get('/api/dashboard/stats', auth.requireAuth(), auditMiddleware('DASHBOARD_STATS'), (req, res) => {
  try {
    const stats = db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('GET /api/dashboard/stats error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve dashboard stats' });
  }
});

// ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────────

// GET /api/admin/stats - admin stats
app.get('/api/admin/stats', requireAdmin, auditMiddleware('ADMIN_STATS'), async (req, res) => {
  try {
    const stats = db.getDashboardStats();
    const totalPatients = (await db.getAllPatients(true)).length;
    const totalDoctors = (await db.getDoctors()).length;
    res.json({ ...stats, totalPatients, totalDoctors });
  } catch (err) {
    console.error('GET /api/admin/stats error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve admin stats' });
  }
});

// GET /api/admin/audit-logs - audit logs (admin only)
app.get('/api/admin/audit-logs', requireAdmin, auditMiddleware('AUDIT_LOGS_ACCESS'), (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = auth.getAuditLogs ? auth.getAuditLogs(limit) : [];
    res.json(logs);
  } catch (err) {
    console.error('GET /api/admin/audit-logs error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

// GET /api/admin/patient-raw/:uid - encrypted patient data (admin audit only)
app.get('/api/admin/patient-raw/:uid', requireAdmin, auditMiddleware('ENCRYPTED_DATA_ACCESSED', (req) => ({ cardUid: req.params.uid })), (req, res) => {
  try {
    const patient = db.getPatientByCardUIDRaw(req.params.uid);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(patient);
  } catch (err) {
    console.error('GET /api/admin/patient-raw/:uid error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve patient data' });
  }
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────────

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  if (!res.headersSent) {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(status).json({ error: message });
  }
});

// ─── PROCESS ERROR HANDLERS ──────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// ─── START SERVER (LOCAL DEV) / EXPORT (VERCEL SERVERLESS) ───────────────────────

if (!process.env.VERCEL) {
  ensureSystemInitialized().then(() => {
    const server = app.listen(PORT, () => {
      console.log(`NFC Hospital Management System running at http://localhost:${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
      console.log('[Security] Helmet, Rate Limiting, Auth & Encryption enabled');
    });

    server.on('error', (err) => {
      console.error('Server HTTP error:', err);
    });
  }).catch(err => {
    console.error('Failed to initialise system:', err);
    process.exit(1);
  });
}

module.exports = app;
