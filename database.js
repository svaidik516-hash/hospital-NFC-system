/**
 * Database module for NFC Hospital Patient Management System
 * Uses sql.js (pure-JS SQLite) — no native compilation required.
 *
 * Call `initDB()` once at startup; after that every exported function is synchronous.
 */

require('dotenv').config();
const initSqlJs = require('sql.js');
let wasmBinary = null;
try {
  wasmBinary = require('./sql-wasm-binary');
} catch (e) {
  console.warn('[Database] Embedded wasm binary not available:', e.message);
}
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

let pgPool = null;

function formatSupabaseUrl(url) {
  if (!url) return url;
  let formatted = String(url).trim();
  if ((formatted.startsWith('"') && formatted.endsWith('"')) || (formatted.startsWith("'") && formatted.endsWith("'"))) {
    formatted = formatted.slice(1, -1).trim();
  }
  // Direct Supabase connections (db.<ref>.supabase.co:5432) are IPv6-only and fail on Vercel AWS Lambda.
  // Automatically rewrite to the IPv4-compatible connection pooler:
  if (formatted.includes('db.buhcundujbwmikttksji.supabase.co')) {
    formatted = formatted
      .replace(/@db\.[a-z0-9]+\.supabase\.co(?::5432)?/, '@aws-1-ap-northeast-2.pooler.supabase.com:6543')
      .replace('postgres:', 'postgres.buhcundujbwmikttksji:');
  }
  return formatted;
}

function getPgPool() {
  if (pgPool) return pgPool;
  const rawUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  const databaseUrl = formatSupabaseUrl(rawUrl);
  if (databaseUrl) {
    try {
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: process.env.VERCEL ? 2 : 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000
      });
      pgPool.on('error', (err) => {
        console.warn('[Supabase Pool Warning]:', err.message);
      });
    } catch (err) {
      console.warn('[Database] Failed to initialize Supabase pool:', err.message);
    }
  }
  return pgPool;
}

async function pgQuery(text, params = []) {
  const pool = getPgPool();
  if (!pool) return null;
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.warn('[Supabase Sync Error]:', err.message);
    return null;
  }
}
// Import crypto functions
const {
  encryptField,
  decryptField,
  isEncrypted,
  getMasterKey,
  decryptPatientData,
  decryptVisitData,
  decryptPrescriptionData,
  decryptLabReportData
} = require('./crypto');

// Export MASTER_KEY for server.js to use
const MASTER_KEY = getMasterKey();
module.exports.MASTER_KEY = MASTER_KEY;

// Ensure data directory exists (use writable /tmp directory when deployed on Vercel)
const dataDir = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (e) {
  console.warn('[Database] Warning creating dataDir:', e.message);
}

const DB_PATH = path.join(dataDir, 'hospital.db');

/** @type {import('sql.js').Database} */
let db;

// ─── Persistence helpers ────────────────────────────────────────────────────────

/** Write the in-memory database to disk. Called after every write operation. */
function save() {
  if (!db) return;
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.warn('[Database] Disk write error (continuing in-memory):', err.message);
  }
}

// ─── Helper wrappers around sql.js's statement API ──────────────────────────────

/** Run a query and return all result rows as plain objects. */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Run a query and return the first result row, or null. */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Execute a write statement. Returns { changes, lastId }. */
function run(sql, params = []) {
  db.run(sql, params);
  const info = db.exec("SELECT last_insert_rowid() AS lastId, changes() AS changes");
  const lastId = info.length ? info[0].values[0][0] : 0;
  const changes = info.length ? info[0].values[0][1] : 0;
  save();
  return { changes, lastId };
}

// ─── Initialisation ─────────────────────────────────────────────────────────────

async function initDB() {
  const SQL = wasmBinary ? await initSqlJs({ wasmBinary }) : await initSqlJs();

  // Load existing DB file or create a fresh one
  let fileBuffer = null;
  if (fs.existsSync(DB_PATH)) {
    try {
      fileBuffer = fs.readFileSync(DB_PATH);
    } catch (e) {
      console.warn('[Database] Could not read DB_PATH:', e.message);
    }
  } else {
    const bundledPath = path.join(__dirname, 'data', 'hospital.db');
    if (fs.existsSync(bundledPath)) {
      try {
        fileBuffer = fs.readFileSync(bundledPath);
      } catch (e) {
        console.warn('[Database] Could not read bundled hospital.db:', e.message);
      }
    }
  }

  if (fileBuffer) {
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // ─── Schema ───────────────────────────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_uid TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      age INTEGER,
      gender TEXT,
      blood_group TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      emergency_contact_relation TEXT,
      address TEXT,
      allergies TEXT,
      chronic_conditions TEXT,
      insurance_id TEXT,
      registered_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      visit_date TEXT DEFAULT (date('now','localtime')),
      check_in_time TEXT,
      check_out_time TEXT,
      department TEXT,
      doctor_name TEXT,
      diagnosis TEXT,
      symptoms TEXT,
      vitals TEXT,
      notes TEXT,
      status TEXT DEFAULT 'checked_in',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER,
      patient_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      instructions TEXT,
      prescribed_by TEXT,
      prescribed_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(visit_id) REFERENCES visits(id),
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT,
      department TEXT,
      doctor_name TEXT,
      reason TEXT,
      status TEXT DEFAULT 'scheduled',
      arrived_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT,
      specialization TEXT,
      contact TEXT,
      status TEXT DEFAULT 'active'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lab_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      test_name TEXT NOT NULL,
      result TEXT,
      normal_range TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(visit_id) REFERENCES visits(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      appointment_id INTEGER,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      sent_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id),
      FOREIGN KEY(visit_id) REFERENCES visits(id),
      FOREIGN KEY(appointment_id) REFERENCES appointments(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // ─── Sync with Supabase (if DATABASE_URL is configured) ────────────────────
  const pool = getPgPool();
  if (pool) {
    try {
      console.log('[Database] Synchronizing persistent state from Supabase...');
      db.run('PRAGMA foreign_keys = OFF');

      // Synchronize PostgreSQL sequences with max(id) across all tables
      const seqTables = ['patients', 'doctors', 'departments', 'visits', 'prescriptions', 'appointments', 'lab_reports', 'notifications'];
      for (const t of seqTables) {
        try {
          await pool.query(`SELECT setval('${t}_id_seq', COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
        } catch (seqErr) {}
      }

      // 1. Departments
      let deptsRes = await pool.query('SELECT * FROM departments ORDER BY id ASC');
      if (deptsRes && deptsRes.rows.length === 0) {
        const defaultDepts = [
          { name: 'General Medicine', description: 'Primary adult care, internal medicine and wellness checks' },
          { name: 'Cardiology', description: 'Heart, cardiovascular diagnostics and intervention' },
          { name: 'Orthopedics', description: 'Bones, joints, spine and musculoskeletal trauma' },
          { name: 'Neurology', description: 'Brain, spinal cord, nerves and neurological disorders' },
          { name: 'Pediatrics', description: 'Infant, child and adolescent health and immunization' },
          { name: 'Dermatology', description: 'Skin, hair, nails and cosmetic dermatology' },
          { name: 'ENT', description: 'Ear, nose, throat and head & neck clinical care' },
          { name: 'Ophthalmology', description: 'Comprehensive eye care, vision and corrective surgery' },
          { name: 'Emergency & Trauma', description: '24/7 urgent resuscitation and acute critical intervention' },
          { name: 'Obstetrics & Gynecology', description: 'Maternity, prenatal delivery and women health services' },
          { name: 'Radiology & Imaging', description: 'Diagnostic X-Ray, CT scans, Ultrasound and MRI' },
          { name: 'General Surgery', description: 'Elective and emergency surgical procedures' }
        ];
        for (const d of defaultDepts) {
          try {
            await pool.query('INSERT INTO departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [d.name, d.description]);
          } catch (e) {}
        }
        deptsRes = await pool.query('SELECT * FROM departments ORDER BY id ASC');
      }
      if (deptsRes) {
        db.run('DELETE FROM departments');
        for (const r of deptsRes.rows) {
          db.run('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
            [r.id, r.name, r.description, r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
      }

      // 2. Doctors
      const docsRes = await pool.query('SELECT * FROM doctors ORDER BY id ASC');
      if (docsRes) {
        db.run('DELETE FROM doctors');
        for (const r of docsRes.rows) {
          db.run('INSERT INTO doctors (id, name, department, specialization, contact, status) VALUES (?, ?, ?, ?, ?, ?)',
            [r.id, r.name, r.department, r.specialization, r.contact, r.status]);
        }
      }

      // 3. Patients
      const patRes = await pool.query('SELECT * FROM patients ORDER BY id ASC');
      if (patRes) {
        db.run('DELETE FROM patients');
        for (const r of patRes.rows) {
          db.run(`INSERT INTO patients (id, card_uid, first_name, last_name, date_of_birth, age, gender,
            blood_group, contact_phone, contact_email, emergency_contact_name, emergency_contact_phone,
            emergency_contact_relation, address, allergies, chronic_conditions, insurance_id, registered_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.card_uid, r.first_name, r.last_name, r.date_of_birth, r.age, r.gender,
             r.blood_group, r.contact_phone, r.contact_email, r.emergency_contact_name, r.emergency_contact_phone,
             r.emergency_contact_relation, r.address, r.allergies, r.chronic_conditions, r.insurance_id,
             r.registered_at ? new Date(r.registered_at).toISOString() : null,
             r.updated_at ? new Date(r.updated_at).toISOString() : null]);
        }
      }

      // 4. Visits
      const visitRes = await pool.query('SELECT * FROM visits ORDER BY id ASC');
      if (visitRes) {
        db.run('DELETE FROM visits');
        for (const r of visitRes.rows) {
          db.run(`INSERT INTO visits (id, patient_id, visit_date, check_in_time, check_out_time, department,
            doctor_name, diagnosis, symptoms, vitals, notes, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.patient_id, r.visit_date, r.check_in_time, r.check_out_time, r.department,
             r.doctor_name, r.diagnosis, r.symptoms, r.vitals, r.notes, r.status,
             r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
      }

      // 5. Prescriptions
      const prescRes = await pool.query('SELECT * FROM prescriptions ORDER BY id ASC');
      if (prescRes) {
        db.run('DELETE FROM prescriptions');
        for (const r of prescRes.rows) {
          db.run(`INSERT INTO prescriptions (id, visit_id, patient_id, medicine_name, dosage, frequency, duration, instructions, prescribed_by, prescribed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.visit_id, r.patient_id, r.medicine_name, r.dosage, r.frequency, r.duration, r.instructions, r.prescribed_by,
             r.prescribed_at ? new Date(r.prescribed_at).toISOString() : null]);
        }
      }

      // 6. Appointments
      const apptRes = await pool.query('SELECT * FROM appointments ORDER BY id ASC');
      if (apptRes) {
        db.run('DELETE FROM appointments');
        for (const r of apptRes.rows) {
          db.run(`INSERT INTO appointments (id, patient_id, appointment_date, appointment_time, department, doctor_name, reason, status, arrived_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.patient_id, r.appointment_date, r.appointment_time, r.department, r.doctor_name, r.reason, r.status, r.arrived_at,
             r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
      }

      // 7. Lab Reports
      const labRes = await pool.query('SELECT * FROM lab_reports ORDER BY id ASC');
      if (labRes) {
        db.run('DELETE FROM lab_reports');
        for (const r of labRes.rows) {
          db.run(`INSERT INTO lab_reports (id, patient_id, visit_id, test_name, result, normal_range, status, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.patient_id, r.visit_id, r.test_name, r.result, r.normal_range, r.status, r.notes,
             r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
      }

      // 8. Notifications
      const notifRes = await pool.query('SELECT * FROM notifications ORDER BY id ASC');
      if (notifRes) {
        db.run('DELETE FROM notifications');
        for (const r of notifRes.rows) {
          db.run(`INSERT INTO notifications (id, patient_id, visit_id, appointment_id, channel, recipient, subject, content, status, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.patient_id, r.visit_id, r.appointment_id, r.channel, r.recipient, r.subject, r.content, r.status,
             r.sent_at ? new Date(r.sent_at).toISOString() : null]);
        }
      }

      console.log('[Database] Supabase synchronization complete.');
    } catch (err) {
      console.warn('[Database] Supabase initial sync warning:', err.message);
    } finally {
      try { db.run('PRAGMA foreign_keys = ON'); } catch (e) {}
    }
  } else {
    // Offline local fallback seeding
    const deptCount = get('SELECT COUNT(*) AS count FROM departments');
    if (!deptCount || deptCount.count === 0) {
      const defaultDepts = [
        { name: 'General Medicine', description: 'Primary adult care, internal medicine and wellness checks' },
        { name: 'Cardiology', description: 'Heart, cardiovascular diagnostics and intervention' },
        { name: 'Orthopedics', description: 'Bones, joints, spine and musculoskeletal trauma' },
        { name: 'Neurology', description: 'Brain, spinal cord, nerves and neurological disorders' },
        { name: 'Pediatrics', description: 'Infant, child and adolescent health and immunization' },
        { name: 'Dermatology', description: 'Skin, hair, nails and cosmetic dermatology' },
        { name: 'ENT', description: 'Ear, nose, throat and head & neck clinical care' },
        { name: 'Ophthalmology', description: 'Comprehensive eye care, vision and corrective surgery' },
        { name: 'Emergency & Trauma', description: '24/7 urgent resuscitation and acute critical intervention' },
        { name: 'Obstetrics & Gynecology', description: 'Maternity, prenatal delivery and women health services' },
        { name: 'Radiology & Imaging', description: 'Diagnostic X-Ray, CT scans, Ultrasound and MRI' },
        { name: 'General Surgery', description: 'Elective and emergency surgical procedures' }
      ];
      for (const d of defaultDepts) {
        run('INSERT OR IGNORE INTO departments (name, description) VALUES (?, ?)', [d.name, d.description]);
      }
      console.log('Seeded initial hospital departments.');
    }
  }

  const finalCount = get('SELECT COUNT(*) AS count FROM patients');
  console.log(`Database ready. Total registered patients: ${finalCount.count}`);

  save();
  console.log('Database initialised at', DB_PATH);
}

// ─── Decryption helper - only decrypt if caller has permission ──────────────────

/**
 * Decrypt patient data if caller has decrypt permission
 * @param {object} patient - Patient record
 * @param {boolean} canDecrypt - Whether caller can decrypt sensitive fields
 * @returns {object} Patient record (decrypted if authorized)
 */
function maybeDecryptPatient(patient, canDecrypt) {
  if (!patient) return null;
  if (canDecrypt) return decryptPatientData(patient);
  return patient; // Return encrypted data
}

/**
 * Decrypt visit data if caller has decrypt permission
 */
function maybeDecryptVisit(visit, canDecrypt) {
  if (!visit) return null;
  if (canDecrypt) return decryptVisitData(visit);
  return visit;
}

/**
 * Decrypt prescription data if caller has decrypt permission
 */
function maybeDecryptPrescription(prescription, canDecrypt) {
  if (!prescription) return null;
  if (canDecrypt) return decryptPrescriptionData(prescription);
  return prescription;
}

// ─── Date helpers ───────────────────────────────────────────────────────────────

function todayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nowDatetime() {
  return new Date().toLocaleString('sv-SE'); // "YYYY-MM-DD HH:MM:SS"
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PATIENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function getPatientByCardUID(uid, canDecrypt = false) {
  if (!uid) return null;
  const cleanUid = String(uid).trim();

  const pool = getPgPool();
  if (pool) {
    try {
      const pRes = await pool.query('SELECT * FROM patients WHERE LOWER(card_uid) = LOWER($1) LIMIT 1', [cleanUid]);
      if (pRes && pRes.rows.length > 0) {
        const r = pRes.rows[0];
        db.run(`INSERT OR REPLACE INTO patients (id, card_uid, first_name, last_name, date_of_birth, age, gender,
          blood_group, contact_phone, contact_email, emergency_contact_name, emergency_contact_phone,
          emergency_contact_relation, address, allergies, chronic_conditions, insurance_id, registered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.card_uid, r.first_name, r.last_name, r.date_of_birth, r.age, r.gender,
           r.blood_group, r.contact_phone, r.contact_email, r.emergency_contact_name, r.emergency_contact_phone,
           r.emergency_contact_relation, r.address, r.allergies, r.chronic_conditions, r.insurance_id,
           r.registered_at ? new Date(r.registered_at).toISOString() : null,
           r.updated_at ? new Date(r.updated_at).toISOString() : null]);

        const decryptedPatient = maybeDecryptPatient(r, canDecrypt);
        const [vRes, rxRes, apRes, lrRes] = await Promise.all([
          pool.query('SELECT * FROM visits WHERE patient_id = $1 ORDER BY visit_date DESC', [r.id]),
          pool.query('SELECT * FROM prescriptions WHERE patient_id = $1 ORDER BY prescribed_at DESC', [r.id]),
          pool.query('SELECT * FROM appointments WHERE patient_id = $1 ORDER BY appointment_date DESC', [r.id]),
          pool.query('SELECT * FROM lab_reports WHERE patient_id = $1 ORDER BY created_at DESC', [r.id])
        ]);
        decryptedPatient.visits = vRes.rows.map(v => maybeDecryptVisit(v, canDecrypt));
        decryptedPatient.prescriptions = rxRes.rows.map(p => maybeDecryptPrescription(p, canDecrypt));
        decryptedPatient.appointments = apRes.rows;
        decryptedPatient.lab_reports = lrRes.rows.map(lr => maybeDecryptLabReport(lr, canDecrypt));
        return decryptedPatient;
      }
    } catch (e) {
      console.warn('[Database] getPatientByCardUID cloud sync warning:', e.message);
    }
  }

  const patient = get('SELECT * FROM patients WHERE LOWER(card_uid) = LOWER(?)', [cleanUid]);
  if (!patient) return null;

  // Decrypt sensitive fields only if authorized
  const decryptedPatient = maybeDecryptPatient(patient, canDecrypt);

  decryptedPatient.visits = all('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC', [decryptedPatient.id])
    .map(v => maybeDecryptVisit(v, canDecrypt));
  decryptedPatient.prescriptions = all('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_at DESC', [decryptedPatient.id])
    .map(p => maybeDecryptPrescription(p, canDecrypt));
  decryptedPatient.appointments = all('SELECT * FROM appointments WHERE patient_id = ? ORDER BY appointment_date DESC', [decryptedPatient.id]);
  decryptedPatient.lab_reports = all('SELECT * FROM lab_reports WHERE patient_id = ? ORDER BY created_at DESC', [decryptedPatient.id]);

  return decryptedPatient;
}

/**
 * Get patient by card UID WITHOUT decryption (admin audit only - shows raw encrypted data)
 * @returns {object|null} Patient record with encrypted fields
 */
function getPatientByCardUIDRaw(uid) {
  if (!uid) return null;
  const cleanUid = String(uid).trim();
  return get('SELECT * FROM patients WHERE LOWER(card_uid) = LOWER(?)', [cleanUid]);
}

async function createPatient(data) {
  // Encrypt sensitive fields at rest
  const sensitive = [
    'allergies', 'chronic_conditions', 'insurance_id', 'address',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation'
  ];
  const encrypted = { ...data };
  for (const field of sensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
  }

  const pool = getPgPool();
  let assignedPatient = null;
  if (pool) {
    try {
      const pRes = await pool.query(`
        INSERT INTO patients (card_uid, first_name, last_name, date_of_birth, age, gender,
          blood_group, contact_phone, contact_email, emergency_contact_name, emergency_contact_phone,
          emergency_contact_relation, address, allergies, chronic_conditions, insurance_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        encrypted.card_uid, encrypted.first_name, encrypted.last_name,
        encrypted.date_of_birth || null, encrypted.age || null, encrypted.gender || null,
        encrypted.blood_group || null, encrypted.contact_phone || null, encrypted.contact_email || null,
        encrypted.emergency_contact_name || null, encrypted.emergency_contact_phone || null,
        encrypted.emergency_contact_relation || null, encrypted.address || null,
        encrypted.allergies || null, encrypted.chronic_conditions || null, encrypted.insurance_id || null
      ]);
      if (pRes && pRes.rows.length > 0) {
        assignedPatient = pRes.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createPatient error:', err.message);
    }
  }

  if (assignedPatient) {
    run(`
      INSERT OR REPLACE INTO patients (id, card_uid, first_name, last_name, date_of_birth, age, gender,
        blood_group, contact_phone, contact_email, emergency_contact_name,
        emergency_contact_phone, emergency_contact_relation, address,
        allergies, chronic_conditions, insurance_id, registered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedPatient.id, assignedPatient.card_uid, assignedPatient.first_name, assignedPatient.last_name,
      assignedPatient.date_of_birth, assignedPatient.age, assignedPatient.gender,
      assignedPatient.blood_group, assignedPatient.contact_phone, assignedPatient.contact_email,
      assignedPatient.emergency_contact_name, assignedPatient.emergency_contact_phone,
      assignedPatient.emergency_contact_relation, assignedPatient.address,
      assignedPatient.allergies, assignedPatient.chronic_conditions, assignedPatient.insurance_id,
      assignedPatient.registered_at ? new Date(assignedPatient.registered_at).toISOString() : nowDatetime(),
      assignedPatient.updated_at ? new Date(assignedPatient.updated_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM patients WHERE id = ?', [assignedPatient.id]);
  }

  const { lastId } = run(`
    INSERT INTO patients (card_uid, first_name, last_name, date_of_birth, age, gender,
      blood_group, contact_phone, contact_email, emergency_contact_name,
      emergency_contact_phone, emergency_contact_relation, address,
      allergies, chronic_conditions, insurance_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    encrypted.card_uid,
    encrypted.first_name,
    encrypted.last_name,
    encrypted.date_of_birth || null,
    encrypted.age || null,
    encrypted.gender || null,
    encrypted.blood_group || null,
    encrypted.contact_phone || null,
    encrypted.contact_email || null,
    encrypted.emergency_contact_name || null,
    encrypted.emergency_contact_phone || null,
    encrypted.emergency_contact_relation || null,
    encrypted.address || null,
    encrypted.allergies || null,
    encrypted.chronic_conditions || null,
    encrypted.insurance_id || null,
  ]);
  return get('SELECT * FROM patients WHERE id = ?', [lastId]);
}

async function updatePatient(id, data) {
  const allowedFields = [
    'card_uid', 'first_name', 'last_name', 'date_of_birth', 'age', 'gender',
    'blood_group', 'contact_phone', 'contact_email', 'emergency_contact_name',
    'emergency_contact_phone', 'emergency_contact_relation', 'address',
    'allergies', 'chronic_conditions', 'insurance_id',
  ];

  const sensitive = ['allergies', 'chronic_conditions', 'insurance_id', 'address',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation'];

  const numId = parseInt(id, 10) || id;
  const sets = [];
  const values = [];
  const pgSets = [];
  const pgValues = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];
      // Encrypt sensitive fields before storage
      if (sensitive.includes(field) && value && !isEncrypted(value)) {
        value = encryptField(value);
      }
      sets.push(`${field} = ?`);
      values.push(value);
      pgSets.push(`${field} = $${paramIdx++}`);
      pgValues.push(value);
    }
  }

  const pool = getPgPool();
  if (pool && pgSets.length > 0) {
    pgSets.push('updated_at = NOW()');
    pgValues.push(numId);
    try {
      await pool.query(`UPDATE patients SET ${pgSets.join(', ')} WHERE id = $${paramIdx}`, pgValues);
    } catch (err) {
      console.warn('[Database] Supabase updatePatient error:', err.message);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now','localtime')");
    values.push(numId);
    run(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  return get('SELECT * FROM patients WHERE id = ?', [numId]);
}

async function getAllPatients(canDecrypt = false) {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM patients ORDER BY registered_at DESC, id DESC');
      if (res && res.rows) {
        db.run('PRAGMA foreign_keys = OFF');
        db.run('DELETE FROM patients');
        for (const r of res.rows) {
          db.run(`INSERT INTO patients (id, card_uid, first_name, last_name, date_of_birth, age, gender,
            blood_group, contact_phone, contact_email, emergency_contact_name, emergency_contact_phone,
            emergency_contact_relation, address, allergies, chronic_conditions, insurance_id, registered_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.id, r.card_uid, r.first_name, r.last_name, r.date_of_birth, r.age, r.gender,
             r.blood_group, r.contact_phone, r.contact_email, r.emergency_contact_name, r.emergency_contact_phone,
             r.emergency_contact_relation, r.address, r.allergies, r.chronic_conditions, r.insurance_id,
             r.registered_at ? new Date(r.registered_at).toISOString() : null,
             r.updated_at ? new Date(r.updated_at).toISOString() : null]);
        }
        db.run('PRAGMA foreign_keys = ON');
        return res.rows.map(p => maybeDecryptPatient(p, canDecrypt));
      }
    } catch (e) {
      console.warn('[Database] getAllPatients cloud sync warning:', e.message);
    }
  }
  return all('SELECT * FROM patients ORDER BY registered_at DESC')
    .map(p => maybeDecryptPatient(p, canDecrypt));
}

async function searchPatients(query, canDecrypt = false) {
  const q = `%${query}%`;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT * FROM patients
        WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR contact_phone ILIKE $1 OR card_uid ILIKE $1
        ORDER BY first_name ASC
      `, [q]);
      if (res && res.rows) {
        return res.rows.map(p => maybeDecryptPatient(p, canDecrypt));
      }
    } catch (e) {
      console.warn('[Database] searchPatients cloud sync warning:', e.message);
    }
  }
  return all(`
    SELECT * FROM patients
    WHERE first_name LIKE ? OR last_name LIKE ? OR contact_phone LIKE ? OR card_uid LIKE ?
    ORDER BY first_name
  `, [q, q, q, q]).map(p => maybeDecryptPatient(p, canDecrypt));
}

async function deletePatient(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM notifications WHERE patient_id = $1', [numId]);
      await pool.query('DELETE FROM lab_reports WHERE patient_id = $1', [numId]);
      await pool.query('DELETE FROM prescriptions WHERE patient_id = $1', [numId]);
      await pool.query('DELETE FROM visits WHERE patient_id = $1', [numId]);
      await pool.query('DELETE FROM appointments WHERE patient_id = $1', [numId]);
      await pool.query('DELETE FROM patients WHERE id = $1', [numId]);
    } catch (err) {
      console.warn('[Database] Supabase deletePatient error:', err.message);
    }
  }

  // Delete child records in SQLite to respect FK constraints
  run('DELETE FROM notifications WHERE patient_id = ?', [numId]);
  run('DELETE FROM lab_reports WHERE patient_id = ?', [numId]);
  run('DELETE FROM prescriptions WHERE patient_id = ?', [numId]);
  run('DELETE FROM visits WHERE patient_id = ?', [numId]);
  run('DELETE FROM appointments WHERE patient_id = ?', [numId]);
  const res = run('DELETE FROM patients WHERE id = ?', [numId]);
  return res.changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VISIT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function createVisit(data) {
  // Encrypt sensitive clinical fields at rest
  const visitSensitive = ['diagnosis', 'symptoms', 'vitals', 'notes'];
  const encrypted = { ...data };
  for (const field of visitSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
  }

  const pool = getPgPool();
  let assignedVisit = null;
  if (pool) {
    try {
      const vRes = await pool.query(`
        INSERT INTO visits (patient_id, visit_date, check_in_time, check_out_time, department, doctor_name,
          diagnosis, symptoms, vitals, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        encrypted.patient_id,
        encrypted.visit_date || todayDate(),
        encrypted.check_in_time || null,
        encrypted.check_out_time || null,
        encrypted.department || null,
        encrypted.doctor_name || null,
        encrypted.diagnosis || null,
        encrypted.symptoms || null,
        encrypted.vitals || null,
        encrypted.notes || null,
        encrypted.status || 'checked_in',
      ]);
      if (vRes && vRes.rows.length > 0) {
        assignedVisit = vRes.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createVisit error:', err.message);
    }
  }

  if (assignedVisit) {
    run(`
      INSERT OR REPLACE INTO visits (id, patient_id, visit_date, check_in_time, check_out_time, department, doctor_name,
        diagnosis, symptoms, vitals, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedVisit.id, assignedVisit.patient_id, assignedVisit.visit_date, assignedVisit.check_in_time,
      assignedVisit.check_out_time, assignedVisit.department, assignedVisit.doctor_name,
      assignedVisit.diagnosis, assignedVisit.symptoms, assignedVisit.vitals, assignedVisit.notes,
      assignedVisit.status, assignedVisit.created_at ? new Date(assignedVisit.created_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM visits WHERE id = ?', [assignedVisit.id]);
  }

  const { lastId } = run(`
    INSERT INTO visits (patient_id, visit_date, check_in_time, department, doctor_name,
      diagnosis, symptoms, vitals, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    encrypted.patient_id,
    encrypted.visit_date || todayDate(),
    encrypted.check_in_time || null,
    encrypted.department || null,
    encrypted.doctor_name || null,
    encrypted.diagnosis || null,
    encrypted.symptoms || null,
    encrypted.vitals || null,
    encrypted.notes || null,
    encrypted.status || 'checked_in',
  ]);
  return get('SELECT * FROM visits WHERE id = ?', [lastId]);
}

async function updateVisit(id, data) {
  const allowedFields = [
    'check_in_time', 'check_out_time', 'department', 'doctor_name',
    'diagnosis', 'symptoms', 'vitals', 'notes', 'status',
  ];

  const visitSensitive = ['diagnosis', 'symptoms', 'vitals', 'notes'];

  const numId = parseInt(id, 10) || id;
  const sets = [];
  const values = [];
  const pgSets = [];
  const pgValues = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];
      // Encrypt sensitive clinical fields before storage
      if (visitSensitive.includes(field) && value && !isEncrypted(value)) {
        value = encryptField(value);
      }
      sets.push(`${field} = ?`);
      values.push(value);
      pgSets.push(`${field} = $${paramIdx++}`);
      pgValues.push(value);
    }
  }

  const pool = getPgPool();
  if (pool && pgSets.length > 0) {
    pgValues.push(numId);
    try {
      await pool.query(`UPDATE visits SET ${pgSets.join(', ')} WHERE id = $${paramIdx}`, pgValues);
    } catch (err) {
      console.warn('[Database] Supabase updateVisit error:', err.message);
    }
  }

  if (sets.length > 0) {
    values.push(numId);
    run(`UPDATE visits SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  return get('SELECT * FROM visits WHERE id = ?', [numId]);
}

async function getVisitsByPatient(patientId, canDecrypt = false) {
  const numId = parseInt(patientId, 10) || patientId;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM visits WHERE patient_id = $1 ORDER BY visit_date DESC, id DESC', [numId]);
      if (res && res.rows) {
        return res.rows.map(v => maybeDecryptVisit(v, canDecrypt));
      }
    } catch (err) {
      console.warn('[Database] Supabase getVisitsByPatient error:', err.message);
    }
  }
  return all('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC', [numId])
    .map(v => maybeDecryptVisit(v, canDecrypt));
}

async function getPrescriptionsByPatient(patientId, canDecrypt = false) {
  const numId = parseInt(patientId, 10) || patientId;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM prescriptions WHERE patient_id = $1 ORDER BY prescribed_at DESC, id DESC', [numId]);
      if (res && res.rows) {
        return res.rows.map(p => maybeDecryptPrescription(p, canDecrypt));
      }
    } catch (err) {
      console.warn('[Database] Supabase getPrescriptionsByPatient error:', err.message);
    }
  }
  return all('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_at DESC', [numId])
    .map(p => maybeDecryptPrescription(p, canDecrypt));
}

async function getPrescriptionsByVisit(visitId, canDecrypt = false) {
  const numId = parseInt(visitId, 10) || visitId;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM prescriptions WHERE visit_id = $1 ORDER BY prescribed_at DESC, id DESC', [numId]);
      if (res && res.rows) {
        return res.rows.map(p => maybeDecryptPrescription(p, canDecrypt));
      }
    } catch (err) {
      console.warn('[Database] Supabase getPrescriptionsByVisit error:', err.message);
    }
  }
  return all('SELECT * FROM prescriptions WHERE visit_id = ? ORDER BY prescribed_at DESC', [numId])
    .map(p => maybeDecryptPrescription(p, canDecrypt));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRESCRIPTION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function createPrescription(data) {
  // Encrypt sensitive prescription fields at rest
  const rxSensitive = ['medicine_name', 'dosage', 'frequency', 'duration', 'instructions'];
  const encrypted = { ...data };
  for (const field of rxSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
  }

  const pool = getPgPool();
  let assignedRx = null;
  if (pool) {
    try {
      const res = await pool.query(`
        INSERT INTO prescriptions (visit_id, patient_id, medicine_name, dosage, frequency,
          duration, instructions, prescribed_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        encrypted.visit_id || null,
        encrypted.patient_id,
        encrypted.medicine_name,
        encrypted.dosage || null,
        encrypted.frequency || null,
        encrypted.duration || null,
        encrypted.instructions || null,
        encrypted.prescribed_by || null,
      ]);
      if (res && res.rows.length > 0) {
        assignedRx = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createPrescription error:', err.message);
    }
  }

  if (assignedRx) {
    run(`
      INSERT OR REPLACE INTO prescriptions (id, visit_id, patient_id, medicine_name, dosage, frequency,
        duration, instructions, prescribed_by, prescribed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedRx.id, assignedRx.visit_id, assignedRx.patient_id, assignedRx.medicine_name,
      assignedRx.dosage, assignedRx.frequency, assignedRx.duration, assignedRx.instructions,
      assignedRx.prescribed_by,
      assignedRx.prescribed_at ? new Date(assignedRx.prescribed_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM prescriptions WHERE id = ?', [assignedRx.id]);
  }

  const { lastId } = run(`
    INSERT INTO prescriptions (visit_id, patient_id, medicine_name, dosage, frequency,
      duration, instructions, prescribed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    encrypted.visit_id || null,
    encrypted.patient_id,
    encrypted.medicine_name,
    encrypted.dosage || null,
    encrypted.frequency || null,
    encrypted.duration || null,
    encrypted.instructions || null,
    encrypted.prescribed_by || null,
  ]);
  return get('SELECT * FROM prescriptions WHERE id = ?', [lastId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APPOINTMENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function createAppointment(data) {
  const pool = getPgPool();
  let assignedAppt = null;
  if (pool) {
    try {
      const res = await pool.query(`
        INSERT INTO appointments (patient_id, appointment_date, appointment_time, department,
          doctor_name, reason, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        data.patient_id,
        data.appointment_date,
        data.appointment_time || null,
        data.department || null,
        data.doctor_name || null,
        data.reason || null,
        data.status || 'scheduled'
      ]);
      if (res && res.rows.length > 0) {
        assignedAppt = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createAppointment error:', err.message);
    }
  }

  if (assignedAppt) {
    run(`
      INSERT OR REPLACE INTO appointments (id, patient_id, appointment_date, appointment_time, department,
        doctor_name, reason, status, arrived_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedAppt.id, assignedAppt.patient_id, assignedAppt.appointment_date, assignedAppt.appointment_time,
      assignedAppt.department, assignedAppt.doctor_name, assignedAppt.reason, assignedAppt.status,
      assignedAppt.arrived_at ? new Date(assignedAppt.arrived_at).toISOString() : null,
      assignedAppt.created_at ? new Date(assignedAppt.created_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM appointments WHERE id = ?', [assignedAppt.id]);
  }

  const { lastId } = run(`
    INSERT INTO appointments (patient_id, appointment_date, appointment_time, department,
      doctor_name, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    data.patient_id,
    data.appointment_date,
    data.appointment_time || null,
    data.department || null,
    data.doctor_name || null,
    data.reason || null,
    data.status || 'scheduled',
  ]);
  return get('SELECT * FROM appointments WHERE id = ?', [lastId]);
}

async function getAppointmentsByDate(date) {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.appointment_date = $1
        ORDER BY a.appointment_time ASC, a.id ASC
      `, [date]);
      if (res && res.rows) {
        return res.rows;
      }
    } catch (e) {
      console.warn('[Database] getAppointmentsByDate cloud sync warning:', e.message);
    }
  }
  return all(`
    SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.appointment_date = ?
    ORDER BY a.appointment_time
  `, [date]);
}

async function getTodayAppointments() {
  return await getAppointmentsByDate(todayDate());
}

async function getTodayArrivals() {
  const today = todayDate();
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.appointment_date = $1 AND a.status = 'arrived'
        ORDER BY a.arrived_at DESC, a.id DESC
      `, [today]);
      if (res && res.rows) {
        return res.rows;
      }
    } catch (e) {
      console.warn('[Database] getTodayArrivals cloud sync warning:', e.message);
    }
  }
  return all(`
    SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.appointment_date = ? AND a.status = 'arrived'
    ORDER BY a.arrived_at DESC
  `, [today]);
}

async function markArrival(patientId) {
  const numId = parseInt(patientId, 10) || patientId;
  const today = todayDate();
  const now = nowDatetime();
  const pool = getPgPool();

  let appointment = null;
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT * FROM appointments
        WHERE patient_id = $1 AND appointment_date = $2 AND status = 'scheduled'
        ORDER BY appointment_time ASC, id ASC
        LIMIT 1
      `, [numId, today]);
      if (res && res.rows.length > 0) {
        appointment = res.rows[0];
      }
    } catch (e) {}
  }
  if (!appointment) {
    appointment = get(`
      SELECT * FROM appointments
      WHERE patient_id = ? AND appointment_date = ? AND status = 'scheduled'
      ORDER BY appointment_time
      LIMIT 1
    `, [numId, today]);
  }

  if (appointment) {
    await updateAppointment(appointment.id, { status: 'arrived', arrived_at: now });

    const visit = await createVisit({
      patient_id: numId,
      check_in_time: now,
      department: appointment.department,
      doctor_name: appointment.doctor_name,
      status: 'checked_in',
    });

    const updatedAppointment = pool ?
      (await pool.query('SELECT * FROM appointments WHERE id = $1', [appointment.id])).rows[0] :
      get('SELECT * FROM appointments WHERE id = ?', [appointment.id]);
    return { appointment: updatedAppointment, visit, isWalkIn: false };
  } else {
    // Walk-in arrival: dynamically assign available doctor or Duty Physician
    const currentTimeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const activeDoc = get("SELECT name FROM doctors WHERE department = 'General Medicine' AND status = 'active' LIMIT 1") ||
                      get("SELECT name FROM doctors WHERE status = 'active' LIMIT 1") ||
                      get("SELECT name FROM doctors LIMIT 1");
    const assignedDoc = activeDoc ? activeDoc.name : 'Duty Physician';

    const apptResult = await createAppointment({
      patient_id: numId,
      appointment_date: today,
      appointment_time: currentTimeStr,
      department: 'General Medicine',
      doctor_name: assignedDoc,
      reason: 'Walk-in Consultation',
      status: 'arrived',
    });
    await updateAppointment(apptResult.id, { arrived_at: now });

    const visit = await createVisit({
      patient_id: numId,
      check_in_time: now,
      department: 'General Medicine',
      doctor_name: assignedDoc,
      status: 'checked_in',
    });

    const updatedAppointment = pool ?
      (await pool.query('SELECT * FROM appointments WHERE id = $1', [apptResult.id])).rows[0] :
      get('SELECT * FROM appointments WHERE id = ?', [apptResult.id]);
    return { appointment: updatedAppointment, visit, isWalkIn: true };
  }
}

async function updateAppointment(id, data) {
  const allowedFields = [
    'appointment_date', 'appointment_time', 'department', 'doctor_name',
    'reason', 'status', 'arrived_at',
  ];
  const numId = parseInt(id, 10) || id;
  const sets = [];
  const values = [];
  const pgSets = [];
  const pgValues = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(data[field]);
      pgSets.push(`${field} = $${paramIdx++}`);
      pgValues.push(data[field]);
    }
  }

  const pool = getPgPool();
  if (pool && pgSets.length > 0) {
    pgValues.push(numId);
    try {
      await pool.query(`UPDATE appointments SET ${pgSets.join(', ')} WHERE id = $${paramIdx}`, pgValues);
    } catch (err) {
      console.warn('[Database] Supabase updateAppointment error:', err.message);
    }
  }

  if (sets.length > 0) {
    values.push(numId);
    run(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  return get('SELECT * FROM appointments WHERE id = ?', [numId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LAB REPORT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function createLabReport(data) {
  // Encrypt sensitive lab report fields at rest
  const labSensitive = ['test_name', 'result', 'normal_range', 'notes'];
  const encrypted = { ...data };
  for (const field of labSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
  }

  const pool = getPgPool();
  let assignedReport = null;
  if (pool) {
    try {
      const res = await pool.query(`
        INSERT INTO lab_reports (patient_id, visit_id, test_name, result, normal_range, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        encrypted.patient_id,
        encrypted.visit_id || null,
        encrypted.test_name,
        encrypted.result || null,
        encrypted.normal_range || null,
        encrypted.status || 'pending',
        encrypted.notes || null,
      ]);
      if (res && res.rows.length > 0) {
        assignedReport = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createLabReport error:', err.message);
    }
  }

  if (assignedReport) {
    run(`
      INSERT OR REPLACE INTO lab_reports (id, patient_id, visit_id, test_name, result, normal_range, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedReport.id, assignedReport.patient_id, assignedReport.visit_id, assignedReport.test_name,
      assignedReport.result, assignedReport.normal_range, assignedReport.status, assignedReport.notes,
      assignedReport.created_at ? new Date(assignedReport.created_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM lab_reports WHERE id = ?', [assignedReport.id]);
  }

  const { lastId } = run(`
    INSERT INTO lab_reports (patient_id, visit_id, test_name, result, normal_range, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    encrypted.patient_id,
    encrypted.visit_id || null,
    encrypted.test_name,
    encrypted.result || null,
    encrypted.normal_range || null,
    encrypted.status || 'pending',
    encrypted.notes || null,
  ]);
  return get('SELECT * FROM lab_reports WHERE id = ?', [lastId]);
}

async function getLabReportsByPatient(patientId, canDecrypt = false) {
  const numId = parseInt(patientId, 10) || patientId;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM lab_reports WHERE patient_id = $1 ORDER BY created_at DESC, id DESC', [numId]);
      if (res && res.rows) {
        return res.rows.map(lr => canDecrypt ? decryptLabReportData(lr) : lr);
      }
    } catch (err) {
      console.warn('[Database] Supabase getLabReportsByPatient error:', err.message);
    }
  }
  return all('SELECT * FROM lab_reports WHERE patient_id = ? ORDER BY created_at DESC', [numId])
    .map(lr => canDecrypt ? decryptLabReportData(lr) : lr);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCTOR OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function getDoctors() {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM doctors ORDER BY name ASC');
      if (res && res.rows) {
        db.run('DELETE FROM doctors');
        for (const r of res.rows) {
          db.run('INSERT INTO doctors (id, name, department, specialization, contact, status) VALUES (?, ?, ?, ?, ?, ?)',
            [r.id, r.name, r.department, r.specialization, r.contact, r.status]);
        }
        return res.rows;
      }
    } catch (e) {
      console.warn('[Database] getDoctors cloud sync warning:', e.message);
    }
  }
  return all('SELECT * FROM doctors ORDER BY name');
}

async function getDoctorById(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM doctors WHERE id = $1 LIMIT 1', [numId]);
      if (res && res.rows.length > 0) {
        const r = res.rows[0];
        db.run('INSERT OR REPLACE INTO doctors (id, name, department, specialization, contact, status) VALUES (?, ?, ?, ?, ?, ?)',
          [r.id, r.name, r.department, r.specialization, r.contact, r.status]);
        return r;
      }
    } catch (e) {
      console.warn('[Database] getDoctorById cloud sync warning:', e.message);
    }
  }
  return get('SELECT * FROM doctors WHERE id = ?', [numId]);
}

async function createDoctor(data) {
  const pool = getPgPool();
  let assignedDoc = null;
  if (pool) {
    try {
      const res = await pool.query(`
        INSERT INTO doctors (name, department, specialization, contact, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        data.name,
        data.department || null,
        data.specialization || null,
        data.contact || null,
        data.status || 'active'
      ]);
      if (res && res.rows.length > 0) {
        assignedDoc = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createDoctor error:', err.message);
    }
  }

  if (assignedDoc) {
    run(`
      INSERT OR REPLACE INTO doctors (id, name, department, specialization, contact, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      assignedDoc.id, assignedDoc.name, assignedDoc.department || null,
      assignedDoc.specialization || null, assignedDoc.contact || null, assignedDoc.status || 'active'
    ]);
    return getDoctorById(assignedDoc.id);
  }

  const { lastId } = run(`
    INSERT INTO doctors (name, department, specialization, contact, status)
    VALUES (?, ?, ?, ?, ?)
  `, [
    data.name,
    data.department || null,
    data.specialization || null,
    data.contact || null,
    data.status || 'active',
  ]);
  return getDoctorById(lastId);
}

async function updateDoctor(id, data) {
  const numId = parseInt(id, 10) || id;
  const allowed = ['name', 'department', 'specialization', 'contact', 'status'];
  const sets = [];
  const params = [];
  const pgSets = [];
  const pgParams = [];
  let paramIdx = 1;

  for (const field of allowed) {
    if (data[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(data[field]);
      pgSets.push(`${field} = $${paramIdx++}`);
      pgParams.push(data[field]);
    }
  }

  const pool = getPgPool();
  if (pool && pgSets.length > 0) {
    pgParams.push(numId);
    try {
      await pool.query(`UPDATE doctors SET ${pgSets.join(', ')} WHERE id = $${paramIdx}`, pgParams);
    } catch (err) {
      console.warn('[Database] Supabase updateDoctor error:', err.message);
    }
  }

  if (sets.length > 0) {
    params.push(numId);
    run(`UPDATE doctors SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  return getDoctorById(numId);
}

async function deleteDoctor(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM doctors WHERE id = $1', [numId]);
    } catch (err) {
      console.warn('[Database] Supabase deleteDoctor error:', err.message);
    }
  }
  run('DELETE FROM doctors WHERE id = ?', [numId]);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DEPARTMENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function getDepartments() {
  const pool = getPgPool();
  if (pool) {
    try {
      let res = await pool.query('SELECT * FROM departments ORDER BY name ASC');
      if (!res || res.rows.length === 0) {
        const defaultDepts = [
          { name: 'General Medicine', description: 'Primary adult care, internal medicine and wellness checks' },
          { name: 'Cardiology', description: 'Heart, cardiovascular diagnostics and intervention' },
          { name: 'Orthopedics', description: 'Bones, joints, spine and musculoskeletal trauma' },
          { name: 'Neurology', description: 'Brain, spinal cord, nerves and neurological disorders' },
          { name: 'Pediatrics', description: 'Infant, child and adolescent health and immunization' },
          { name: 'Dermatology', description: 'Skin, hair, nails and cosmetic dermatology' },
          { name: 'ENT', description: 'Ear, nose, throat and head & neck clinical care' },
          { name: 'Ophthalmology', description: 'Comprehensive eye care, vision and corrective surgery' },
          { name: 'Emergency & Trauma', description: '24/7 urgent resuscitation and acute critical intervention' },
          { name: 'Obstetrics & Gynecology', description: 'Maternity, prenatal delivery and women health services' },
          { name: 'Radiology & Imaging', description: 'Diagnostic X-Ray, CT scans, Ultrasound and MRI' },
          { name: 'General Surgery', description: 'Elective and emergency surgical procedures' }
        ];
        for (const d of defaultDepts) {
          try {
            await pool.query('INSERT INTO departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [d.name, d.description]);
          } catch (e) {}
        }
        res = await pool.query('SELECT * FROM departments ORDER BY name ASC');
      }

      if (res && res.rows && res.rows.length > 0) {
        db.run('DELETE FROM departments');
        for (const r of res.rows) {
          db.run('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
            [r.id, r.name, r.description, r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
        return res.rows.map(d => {
          const docCount = get('SELECT COUNT(*) AS count FROM doctors WHERE department = ?', [d.name]);
          return {
            ...d,
            doctor_count: docCount ? docCount.count : 0
          };
        });
      }
    } catch (e) {
      console.warn('[Database] getDepartments cloud sync warning:', e.message);
    }
  }

  const depts = all('SELECT * FROM departments ORDER BY name ASC');
  return depts.map(d => {
    const docCount = get('SELECT COUNT(*) AS count FROM doctors WHERE department = ?', [d.name]);
    return {
      ...d,
      doctor_count: docCount ? docCount.count : 0
    };
  });
}

async function getDepartmentById(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM departments WHERE id = $1', [numId]);
      if (res && res.rows.length > 0) return res.rows[0];
    } catch (e) {}
  }
  return get('SELECT * FROM departments WHERE id = ?', [numId]);
}

async function getDepartmentByName(name) {
  if (!name) return null;
  const cleanName = String(name).trim();
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM departments WHERE LOWER(name) = LOWER($1) LIMIT 1', [cleanName]);
      if (res && res.rows.length > 0) return res.rows[0];
    } catch (e) {}
  }
  return get('SELECT * FROM departments WHERE LOWER(name) = LOWER(?)', [cleanName]);
}

async function createDepartment(data) {
  const name = data.name.trim();
  const description = data.description ? data.description.trim() : null;
  const pool = getPgPool();
  let assignedDept = null;
  if (pool) {
    try {
      const res = await pool.query('INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING *', [name, description]);
      if (res && res.rows.length > 0) {
        assignedDept = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createDepartment error:', err.message);
    }
  }

  if (assignedDept) {
    run('INSERT OR REPLACE INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
      [assignedDept.id, assignedDept.name, assignedDept.description, assignedDept.created_at ? new Date(assignedDept.created_at).toISOString() : nowDatetime()]);
    return assignedDept;
  }

  const { lastId } = run(`
    INSERT INTO departments (name, description)
    VALUES (?, ?)
  `, [name, description]);
  return get('SELECT * FROM departments WHERE id = ?', [lastId]);
}

async function updateDepartment(id, data) {
  const numId = parseInt(id, 10) || id;
  const existing = await getDepartmentById(numId);
  if (!existing) return null;

  const newName = data.name !== undefined ? data.name.trim() : existing.name;
  const newDesc = data.description !== undefined ? (data.description ? data.description.trim() : null) : existing.description;

  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query('UPDATE departments SET name = $2, description = $3 WHERE id = $1', [numId, newName, newDesc]);
      if (newName !== existing.name) {
        await pool.query('UPDATE doctors SET department = $1 WHERE department = $2', [newName, existing.name]);
        await pool.query('UPDATE appointments SET department = $1 WHERE department = $2', [newName, existing.name]);
        await pool.query('UPDATE visits SET department = $1 WHERE department = $2', [newName, existing.name]);
      }
    } catch (err) {
      console.warn('[Database] Supabase updateDepartment error:', err.message);
    }
  }

  run('UPDATE departments SET name = ?, description = ? WHERE id = ?', [newName, newDesc, numId]);
  if (newName !== existing.name) {
    run('UPDATE doctors SET department = ? WHERE department = ?', [newName, existing.name]);
    run('UPDATE appointments SET department = ? WHERE department = ?', [newName, existing.name]);
    run('UPDATE visits SET department = ? WHERE department = ?', [newName, existing.name]);
  }

  return await getDepartmentById(numId);
}

async function deleteDepartment(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM departments WHERE id = $1', [numId]);
    } catch (err) {
      console.warn('[Database] Supabase deleteDepartment error:', err.message);
    }
  }
  run('DELETE FROM departments WHERE id = ?', [numId]);
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

async function getDashboardStats() {
  const today = todayDate();
  const pool = getPgPool();
  if (pool) {
    try {
      const [pRes, aRes, arrRes, vRes] = await Promise.all([
        pool.query('SELECT COUNT(*) AS count FROM patients'),
        pool.query('SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = $1', [today]),
        pool.query("SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = $1 AND status = 'arrived'", [today]),
        pool.query("SELECT COUNT(*) AS count FROM visits WHERE visit_date = $1 AND status = 'checked_in'", [today])
      ]);
      return {
        totalPatients: parseInt(pRes.rows[0].count, 10) || 0,
        todayAppointments: parseInt(aRes.rows[0].count, 10) || 0,
        todayArrivals: parseInt(arrRes.rows[0].count, 10) || 0,
        activeVisits: parseInt(vRes.rows[0].count, 10) || 0,
      };
    } catch (e) {
      console.warn('[Database] getDashboardStats Supabase warning:', e.message);
    }
  }

  const totalPatients = get('SELECT COUNT(*) AS count FROM patients').count;
  const todayAppointments = get('SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ?', [today]).count;
  const todayArrivals = get("SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ? AND status = 'arrived'", [today]).count;
  const activeVisits = get("SELECT COUNT(*) AS count FROM visits WHERE visit_date = ? AND status = 'checked_in'", [today]).count;

  return { totalPatients, todayAppointments, todayArrivals, activeVisits };
}

// ══════════════════════════════════════════════════════════════════════════════
//  FULL PATIENT RECORD
// ══════════════════════════════════════════════════════════════════════════════

async function getFullPatientRecord(cardUID, canDecrypt = false) {
  const patient = await getPatientByCardUID(cardUID, canDecrypt);
  if (!patient) return null;

  const decryptedPatient = patient;
  const pool = getPgPool();

  let visits = decryptedPatient.visits || [];
  let appointments = decryptedPatient.appointments || [];
  let labReports = decryptedPatient.lab_reports || [];
  let notifications = [];

  if (pool) {
    try {
      const notifRes = await pool.query('SELECT * FROM notifications WHERE patient_id = $1 ORDER BY sent_at DESC, id DESC', [decryptedPatient.id]);
      notifications = notifRes.rows;
    } catch (e) {}
  } else {
    notifications = all('SELECT * FROM notifications WHERE patient_id = ? ORDER BY sent_at DESC', [decryptedPatient.id]);
  }

  return {
    ...decryptedPatient,
    patient: decryptedPatient,
    visits,
    appointments,
    lab_reports: labReports,
    labReports,
    notifications,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATION OPERATIONS
// ══════════════════════════════════════════════════════════════════════════════

async function createNotification(data) {
  const pool = getPgPool();
  let assignedNotif = null;
  if (pool) {
    try {
      const res = await pool.query(`
        INSERT INTO notifications (patient_id, visit_id, appointment_id, channel, recipient, subject, content, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        data.patient_id,
        data.visit_id || null,
        data.appointment_id || null,
        data.channel,
        data.recipient,
        data.subject || null,
        data.content,
        data.status || 'sent',
      ]);
      if (res && res.rows.length > 0) {
        assignedNotif = res.rows[0];
      }
    } catch (err) {
      console.warn('[Database] Supabase createNotification error:', err.message);
    }
  }

  if (assignedNotif) {
    run(`
      INSERT OR REPLACE INTO notifications (id, patient_id, visit_id, appointment_id, channel, recipient, subject, content, status, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignedNotif.id, assignedNotif.patient_id, assignedNotif.visit_id, assignedNotif.appointment_id,
      assignedNotif.channel, assignedNotif.recipient, assignedNotif.subject, assignedNotif.content,
      assignedNotif.status, assignedNotif.sent_at ? new Date(assignedNotif.sent_at).toISOString() : nowDatetime()
    ]);
    return get('SELECT * FROM notifications WHERE id = ?', [assignedNotif.id]);
  }

  const { lastId } = run(`
    INSERT INTO notifications (patient_id, visit_id, appointment_id, channel, recipient, subject, content, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    data.patient_id,
    data.visit_id || null,
    data.appointment_id || null,
    data.channel,
    data.recipient,
    data.subject || null,
    data.content,
    data.status || 'sent',
  ]);
  return get('SELECT * FROM notifications WHERE id = ?', [lastId]);
}

async function getNotificationsByPatient(patientId) {
  const numId = parseInt(patientId, 10) || patientId;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM notifications WHERE patient_id = $1 ORDER BY sent_at DESC, id DESC', [numId]);
      if (res && res.rows) return res.rows;
    } catch (e) {}
  }
  return all('SELECT * FROM notifications WHERE patient_id = ? ORDER BY sent_at DESC', [numId]);
}

async function getNotificationById(id) {
  const numId = parseInt(id, 10) || id;
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM notifications WHERE id = $1', [numId]);
      if (res && res.rows.length > 0) return res.rows[0];
    } catch (e) {}
  }
  return get('SELECT * FROM notifications WHERE id = ?', [numId]);
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  initDB,
  getPgPool,
  getPatientByCardUID,
  getPatientByCardUIDRaw,
  createPatient,
  updatePatient,
  deletePatient,
  getAllPatients,
  searchPatients,
  createVisit,
  updateVisit,
  getVisitsByPatient,
  createPrescription,
  getPrescriptionsByPatient,
  getPrescriptionsByVisit,
  createAppointment,
  updateAppointment,
  getAppointmentsByDate,
  markArrival,
  getTodayAppointments,
  getTodayArrivals,
  createLabReport,
  getLabReportsByPatient,
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  getDepartments,
  getDepartmentById,
  getDepartmentByName,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDashboardStats,
  getFullPatientRecord,
  maybeDecryptPatient,
  maybeDecryptVisit,
  maybeDecryptPrescription,
  createNotification,
  getNotificationsByPatient,
  getNotificationById,
  MASTER_KEY,
};