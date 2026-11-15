/**
 * Database module for NFC Hospital Patient Management System
 * Uses sql.js (pure-JS SQLite) — no native compilation required.
 *
 * Call `initDB()` once at startup; after that every exported function is synchronous.
 */

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

function getPgPool() {
  if (pgPool) return pgPool;
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (databaseUrl) {
    try {
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
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
      // 1. Departments
      const deptsRes = await pool.query('SELECT * FROM departments ORDER BY id ASC');
      if (deptsRes && deptsRes.rows.length > 0) {
        db.run('DELETE FROM departments');
        for (const r of deptsRes.rows) {
          db.run('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
            [r.id, r.name, r.description, r.created_at ? new Date(r.created_at).toISOString() : null]);
        }
      }

      // 2. Doctors
      const docsRes = await pool.query('SELECT * FROM doctors ORDER BY id ASC');
      if (docsRes && docsRes.rows.length > 0) {
        db.run('DELETE FROM doctors');
        for (const r of docsRes.rows) {
          db.run('INSERT INTO doctors (id, name, department, specialization, contact, status) VALUES (?, ?, ?, ?, ?, ?)',
            [r.id, r.name, r.department, r.specialization, r.contact, r.status]);
        }
      }

      // 3. Patients
      const patRes = await pool.query('SELECT * FROM patients ORDER BY id ASC');
      if (patRes && patRes.rows.length > 0) {
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
      if (visitRes && visitRes.rows.length > 0) {
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
      if (prescRes && prescRes.rows.length > 0) {
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
      if (apptRes && apptRes.rows.length > 0) {
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
      if (labRes && labRes.rows.length > 0) {
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
      if (notifRes && notifRes.rows.length > 0) {
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

    const countRow = get('SELECT COUNT(*) AS count FROM doctors');
    if (countRow.count === 0) {
      run('INSERT INTO doctors (name, department, specialization) VALUES (?, ?, ?)',
          ['Dr. Sarah Johnson', 'Cardiology', 'Cardiology']);
      run('INSERT INTO doctors (name, department, specialization) VALUES (?, ?, ?)',
          ['Dr. Michael Chen', 'General Medicine', 'General Medicine']);
      run('INSERT INTO doctors (name, department, specialization) VALUES (?, ?, ?)',
          ['Dr. Emily Williams', 'Orthopedics', 'Orthopedics']);
      run('INSERT INTO doctors (name, department, specialization) VALUES (?, ?, ?)',
          ['Dr. James Brown', 'Neurology', 'Neurology']);
      run('INSERT INTO doctors (name, department, specialization) VALUES (?, ?, ?)',
          ['Dr. Lisa Anderson', 'Pediatrics', 'Pediatrics']);
      console.log('Seeded 5 sample doctors.');
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

function getPatientByCardUID(uid, canDecrypt = false) {
  if (!uid) return null;
  const cleanUid = String(uid).trim();
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

function createPatient(data) {
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
  const newPatient = get('SELECT * FROM patients WHERE id = ?', [lastId]);
  if (newPatient) {
    pgQuery(`
      INSERT INTO patients (id, card_uid, first_name, last_name, date_of_birth, age, gender,
        blood_group, contact_phone, contact_email, emergency_contact_name, emergency_contact_phone,
        emergency_contact_relation, address, allergies, chronic_conditions, insurance_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        card_uid = EXCLUDED.card_uid, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        date_of_birth = EXCLUDED.date_of_birth, age = EXCLUDED.age, gender = EXCLUDED.gender,
        blood_group = EXCLUDED.blood_group, contact_phone = EXCLUDED.contact_phone,
        contact_email = EXCLUDED.contact_email, emergency_contact_name = EXCLUDED.emergency_contact_name,
        emergency_contact_phone = EXCLUDED.emergency_contact_phone, emergency_contact_relation = EXCLUDED.emergency_contact_relation,
        address = EXCLUDED.address, allergies = EXCLUDED.allergies, chronic_conditions = EXCLUDED.chronic_conditions,
        insurance_id = EXCLUDED.insurance_id, updated_at = NOW()
    `, [
      newPatient.id, newPatient.card_uid, newPatient.first_name, newPatient.last_name, newPatient.date_of_birth,
      newPatient.age, newPatient.gender, newPatient.blood_group, newPatient.contact_phone, newPatient.contact_email,
      newPatient.emergency_contact_name, newPatient.emergency_contact_phone, newPatient.emergency_contact_relation,
      newPatient.address, newPatient.allergies, newPatient.chronic_conditions, newPatient.insurance_id
    ]);
  }
  return newPatient;
}

function updatePatient(id, data) {
  const allowedFields = [
    'card_uid', 'first_name', 'last_name', 'date_of_birth', 'age', 'gender',
    'blood_group', 'contact_phone', 'contact_email', 'emergency_contact_name',
    'emergency_contact_phone', 'emergency_contact_relation', 'address',
    'allergies', 'chronic_conditions', 'insurance_id',
  ];

  const sensitive = ['allergies', 'chronic_conditions', 'insurance_id', 'address',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation'];

  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];
      // Encrypt sensitive fields before storage
      if (sensitive.includes(field) && value && !isEncrypted(value)) {
        value = encryptField(value);
      }
      sets.push(`${field} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return get('SELECT * FROM patients WHERE id = ?', [id]);

  sets.push("updated_at = datetime('now','localtime')");
  values.push(id);
  run(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`, values);
  const updated = get('SELECT * FROM patients WHERE id = ?', [id]);
  if (updated) {
    pgQuery(`
      UPDATE patients SET
        card_uid = $2, first_name = $3, last_name = $4, date_of_birth = $5, age = $6, gender = $7,
        blood_group = $8, contact_phone = $9, contact_email = $10, emergency_contact_name = $11,
        emergency_contact_phone = $12, emergency_contact_relation = $13, address = $14,
        allergies = $15, chronic_conditions = $16, insurance_id = $17, updated_at = NOW()
      WHERE id = $1
    `, [
      updated.id, updated.card_uid, updated.first_name, updated.last_name, updated.date_of_birth,
      updated.age, updated.gender, updated.blood_group, updated.contact_phone, updated.contact_email,
      updated.emergency_contact_name, updated.emergency_contact_phone, updated.emergency_contact_relation,
      updated.address, updated.allergies, updated.chronic_conditions, updated.insurance_id
    ]);
  }
  return updated;
}

function getAllPatients(canDecrypt = false) {
  return all('SELECT * FROM patients ORDER BY registered_at DESC')
    .map(p => maybeDecryptPatient(p, canDecrypt));
}

function searchPatients(query) {
  const q = `%${query}%`;
  return all(`
    SELECT * FROM patients
    WHERE first_name LIKE ? OR last_name LIKE ? OR contact_phone LIKE ? OR card_uid LIKE ?
    ORDER BY first_name
  `, [q, q, q, q]);
}

function deletePatient(id) {
  run('DELETE FROM notifications WHERE patient_id = ?', [id]);
  run('DELETE FROM lab_reports WHERE patient_id = ?', [id]);
  run('DELETE FROM prescriptions WHERE patient_id = ?', [id]);
  run('DELETE FROM visits WHERE patient_id = ?', [id]);
  run('DELETE FROM appointments WHERE patient_id = ?', [id]);
  const res = run('DELETE FROM patients WHERE id = ?', [id]);
  pgQuery('DELETE FROM patients WHERE id = $1', [id]);
  return res.changes > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VISIT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function createVisit(data) {
  // Encrypt sensitive clinical fields at rest
  const visitSensitive = ['diagnosis', 'symptoms', 'vitals', 'notes'];
  const encrypted = { ...data };
  for (const field of visitSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
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
  const visit = get('SELECT * FROM visits WHERE id = ?', [lastId]);
  if (visit) {
    pgQuery(`
      INSERT INTO visits (id, patient_id, visit_date, check_in_time, check_out_time, department, doctor_name, diagnosis, symptoms, vitals, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, check_out_time = EXCLUDED.check_out_time
    `, [visit.id, visit.patient_id, visit.visit_date, visit.check_in_time, visit.check_out_time, visit.department, visit.doctor_name, visit.diagnosis, visit.symptoms, visit.vitals, visit.notes, visit.status]);
  }
  return visit;
}

function updateVisit(id, data) {
  const allowedFields = [
    'check_in_time', 'check_out_time', 'department', 'doctor_name',
    'diagnosis', 'symptoms', 'vitals', 'notes', 'status',
  ];

  const visitSensitive = ['diagnosis', 'symptoms', 'vitals', 'notes'];

  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      let value = data[field];
      // Encrypt sensitive clinical fields before storage
      if (visitSensitive.includes(field) && value && !isEncrypted(value)) {
        value = encryptField(value);
      }
      sets.push(`${field} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return get('SELECT * FROM visits WHERE id = ?', [id]);

  values.push(id);
  run(`UPDATE visits SET ${sets.join(', ')} WHERE id = ?`, values);
  const updated = get('SELECT * FROM visits WHERE id = ?', [id]);
  if (updated) {
    pgQuery(`
      UPDATE visits SET check_in_time = $2, check_out_time = $3, department = $4, doctor_name = $5,
        diagnosis = $6, symptoms = $7, vitals = $8, notes = $9, status = $10 WHERE id = $1
    `, [updated.id, updated.check_in_time, updated.check_out_time, updated.department, updated.doctor_name, updated.diagnosis, updated.symptoms, updated.vitals, updated.notes, updated.status]);
  }
  return updated;
}

function getVisitsByPatient(patientId, canDecrypt = false) {
  return all('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC', [patientId])
    .map(v => maybeDecryptVisit(v, canDecrypt));
}

function getPrescriptionsByPatient(patientId, canDecrypt = false) {
  return all('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_at DESC', [patientId])
    .map(p => maybeDecryptPrescription(p, canDecrypt));
}

function getPrescriptionsByVisit(visitId, canDecrypt = false) {
  return all('SELECT * FROM prescriptions WHERE visit_id = ? ORDER BY prescribed_at DESC', [visitId])
    .map(p => maybeDecryptPrescription(p, canDecrypt));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRESCRIPTION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function createPrescription(data) {
  // Encrypt sensitive prescription fields at rest
  const rxSensitive = ['medicine_name', 'dosage', 'frequency', 'duration', 'instructions'];
  const encrypted = { ...data };
  for (const field of rxSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
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
  const presc = get('SELECT * FROM prescriptions WHERE id = ?', [lastId]);
  if (presc) {
    pgQuery(`
      INSERT INTO prescriptions (id, visit_id, patient_id, medicine_name, dosage, frequency, duration, instructions, prescribed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [presc.id, presc.visit_id, presc.patient_id, presc.medicine_name, presc.dosage, presc.frequency, presc.duration, presc.instructions, presc.prescribed_by]);
  }
  return presc;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APPOINTMENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function createAppointment(data) {
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
  const appt = get('SELECT * FROM appointments WHERE id = ?', [lastId]);
  if (appt) {
    pgQuery(`
      INSERT INTO appointments (id, patient_id, appointment_date, appointment_time, department, doctor_name, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [appt.id, appt.patient_id, appt.appointment_date, appt.appointment_time, appt.department, appt.doctor_name, appt.reason, appt.status]);
  }
  return appt;
}

function getAppointmentsByDate(date) {
  return all(`
    SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.appointment_date = ?
    ORDER BY a.appointment_time
  `, [date]);
}

function getTodayAppointments() {
  return getAppointmentsByDate(todayDate());
}

function getTodayArrivals() {
  return all(`
    SELECT a.*, p.first_name, p.last_name, p.card_uid, p.contact_phone
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.appointment_date = ? AND a.status = 'arrived'
    ORDER BY a.arrived_at DESC
  `, [todayDate()]);
}

function markArrival(patientId) {
  const today = todayDate();
  const now = nowDatetime();

  const appointment = get(`
    SELECT * FROM appointments
    WHERE patient_id = ? AND appointment_date = ? AND status = 'scheduled'
    ORDER BY appointment_time
    LIMIT 1
  `, [patientId, today]);

  if (appointment) {
    run('UPDATE appointments SET status = ?, arrived_at = ? WHERE id = ?', ['arrived', now, appointment.id]);
    pgQuery('UPDATE appointments SET status = $2, arrived_at = $3 WHERE id = $1', [appointment.id, 'arrived', now]);

    const visit = createVisit({
      patient_id: patientId,
      check_in_time: now,
      department: appointment.department,
      doctor_name: appointment.doctor_name,
      status: 'checked_in',
    });

    const updatedAppointment = get('SELECT * FROM appointments WHERE id = ?', [appointment.id]);
    return { appointment: updatedAppointment, visit, isWalkIn: false };
  } else {
    // Walk-in arrival: create an appointment record for today's queue and an active visit
    const currentTimeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const apptResult = createAppointment({
      patient_id: patientId,
      appointment_date: today,
      appointment_time: currentTimeStr,
      department: 'General Medicine',
      doctor_name: 'Dr. Michael Chen',
      reason: 'Walk-in Consultation',
      status: 'arrived',
    });
    run('UPDATE appointments SET arrived_at = ? WHERE id = ?', [now, apptResult.id]);
    pgQuery('UPDATE appointments SET arrived_at = $2 WHERE id = $1', [apptResult.id, now]);

    const visit = createVisit({
      patient_id: patientId,
      check_in_time: now,
      department: 'General Medicine',
      doctor_name: 'Dr. Michael Chen',
      status: 'checked_in',
    });

    const updatedAppointment = get('SELECT * FROM appointments WHERE id = ?', [apptResult.id]);
    return { appointment: updatedAppointment, visit, isWalkIn: true };
  }
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

function updateAppointment(id, data) {
  const allowedFields = [
    'appointment_date', 'appointment_time', 'department', 'doctor_name',
    'reason', 'status', 'arrived_at',
  ];
  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(data[field]);
    }
  }
  if (sets.length === 0) return get('SELECT * FROM appointments WHERE id = ?', [id]);
  values.push(id);
  run(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, values);
  return get('SELECT * FROM appointments WHERE id = ?', [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LAB REPORT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function createLabReport(data) {
  // Encrypt sensitive lab report fields at rest
  const labSensitive = ['test_name', 'result', 'normal_range', 'notes'];
  const encrypted = { ...data };
  for (const field of labSensitive) {
    if (encrypted[field] && !isEncrypted(encrypted[field])) {
      encrypted[field] = encryptField(encrypted[field]);
    }
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
  const report = get('SELECT * FROM lab_reports WHERE id = ?', [lastId]);
  if (report) {
    pgQuery(`
      INSERT INTO lab_reports (id, patient_id, visit_id, test_name, result, normal_range, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET result = EXCLUDED.result, status = EXCLUDED.status, notes = EXCLUDED.notes
    `, [report.id, report.patient_id, report.visit_id, report.test_name, report.result, report.normal_range, report.status, report.notes]);
  }
  return report;
}

function getLabReportsByPatient(patientId, canDecrypt = false) {
  return all('SELECT * FROM lab_reports WHERE patient_id = ? ORDER BY created_at DESC', [patientId])
    .map(lr => canDecrypt ? decryptLabReportData(lr) : lr);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCTOR OPERATIONS
// ══════════════════════════════════════════════════════════════════════════════

function getDoctors() {
  return all('SELECT * FROM doctors ORDER BY name');
}

function getDoctorById(id) {
  return get('SELECT * FROM doctors WHERE id = ?', [id]);
}

function createDoctor(data) {
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
  const newDoc = get('SELECT * FROM doctors WHERE id = ?', [lastId]);
  if (newDoc) {
    pgQuery(`
      INSERT INTO doctors (id, name, department, specialization, contact, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, department = EXCLUDED.department,
        specialization = EXCLUDED.specialization, contact = EXCLUDED.contact, status = EXCLUDED.status
    `, [newDoc.id, newDoc.name, newDoc.department, newDoc.specialization, newDoc.contact, newDoc.status]);
  }
  return newDoc;
}

function updateDoctor(id, data) {
  const allowed = ['name', 'department', 'specialization', 'contact', 'status'];
  const sets = [];
  const params = [];

  for (const field of allowed) {
    if (data[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(data[field]);
    }
  }

  if (sets.length === 0) {
    return getDoctorById(id);
  }

  params.push(id);
  run(`UPDATE doctors SET ${sets.join(', ')} WHERE id = ?`, params);
  const updated = getDoctorById(id);
  if (updated) {
    pgQuery(`
      UPDATE doctors SET name = $2, department = $3, specialization = $4, contact = $5, status = $6 WHERE id = $1
    `, [updated.id, updated.name, updated.department, updated.specialization, updated.contact, updated.status]);
  }
  return updated;
}

function deleteDoctor(id) {
  const doc = getDoctorById(id);
  if (!doc) return false;
  run('DELETE FROM doctors WHERE id = ?', [id]);
  pgQuery('DELETE FROM doctors WHERE id = $1', [id]);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DEPARTMENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getDepartments() {
  const depts = all('SELECT * FROM departments ORDER BY name ASC');
  return depts.map(d => {
    const docCount = get('SELECT COUNT(*) AS count FROM doctors WHERE department = ?', [d.name]);
    return {
      ...d,
      doctor_count: docCount ? docCount.count : 0
    };
  });
}

function getDepartmentById(id) {
  return get('SELECT * FROM departments WHERE id = ?', [id]);
}

function getDepartmentByName(name) {
  return get('SELECT * FROM departments WHERE LOWER(name) = LOWER(?)', [name.trim()]);
}

function createDepartment(data) {
  const name = data.name.trim();
  const description = data.description ? data.description.trim() : null;
  const { lastId } = run(`
    INSERT INTO departments (name, description)
    VALUES (?, ?)
  `, [name, description]);
  const dept = getDepartmentById(lastId);
  if (dept) {
    pgQuery('INSERT INTO departments (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING', [dept.id, dept.name, dept.description]);
  }
  return dept;
}

function updateDepartment(id, data) {
  const existing = getDepartmentById(id);
  if (!existing) return null;

  const newName = data.name !== undefined ? data.name.trim() : existing.name;
  const newDesc = data.description !== undefined ? (data.description ? data.description.trim() : null) : existing.description;

  run('UPDATE departments SET name = ?, description = ? WHERE id = ?', [newName, newDesc, id]);

  // If department name was modified, cascade to doctors, appointments and visits
  if (newName !== existing.name) {
    run('UPDATE doctors SET department = ? WHERE department = ?', [newName, existing.name]);
    run('UPDATE appointments SET department = ? WHERE department = ?', [newName, existing.name]);
    run('UPDATE visits SET department = ? WHERE department = ?', [newName, existing.name]);
  }

  const updated = getDepartmentById(id);
  if (updated) {
    pgQuery('UPDATE departments SET name = $2, description = $3 WHERE id = $1', [updated.id, updated.name, updated.description]);
    if (newName !== existing.name) {
      pgQuery('UPDATE doctors SET department = $1 WHERE department = $2', [newName, existing.name]);
      pgQuery('UPDATE appointments SET department = $1 WHERE department = $2', [newName, existing.name]);
      pgQuery('UPDATE visits SET department = $1 WHERE department = $2', [newName, existing.name]);
    }
  }

  return updated;
}

function deleteDepartment(id) {
  const dept = getDepartmentById(id);
  if (!dept) return false;
  run('DELETE FROM departments WHERE id = ?', [id]);
  pgQuery('DELETE FROM departments WHERE id = $1', [id]);
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

function getDashboardStats() {
  const today = todayDate();
  const totalPatients = get('SELECT COUNT(*) AS count FROM patients').count;
  const todayAppointments = get('SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ?', [today]).count;
  const todayArrivals = get("SELECT COUNT(*) AS count FROM appointments WHERE appointment_date = ? AND status = 'arrived'", [today]).count;
  const activeVisits = get("SELECT COUNT(*) AS count FROM visits WHERE visit_date = ? AND status = 'checked_in'", [today]).count;

  return { totalPatients, todayAppointments, todayArrivals, activeVisits };
}

// ══════════════════════════════════════════════════════════════════════════════
//  FULL PATIENT RECORD
// ══════════════════════════════════════════════════════════════════════════════

function getFullPatientRecord(cardUID, canDecrypt = false) {
  const patient = get('SELECT * FROM patients WHERE card_uid = ?', [cardUID]);
  if (!patient) return null;

  const decryptedPatient = maybeDecryptPatient(patient, canDecrypt);

  const visits = all('SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC', [decryptedPatient.id])
    .map(v => {
      const decryptedVisit = maybeDecryptVisit(v, canDecrypt);
      decryptedVisit.prescriptions = all('SELECT * FROM prescriptions WHERE visit_id = ? ORDER BY prescribed_at DESC', [v.id])
        .map(p => maybeDecryptPrescription(p, canDecrypt));
      return decryptedVisit;
    });

  const appointments = all('SELECT * FROM appointments WHERE patient_id = ? ORDER BY appointment_date DESC', [decryptedPatient.id]);
  const labReports = all('SELECT * FROM lab_reports WHERE patient_id = ? ORDER BY created_at DESC', [decryptedPatient.id]);
  const notifications = all('SELECT * FROM notifications WHERE patient_id = ? ORDER BY sent_at DESC', [decryptedPatient.id]);

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

function createNotification(data) {
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
  const notif = get('SELECT * FROM notifications WHERE id = ?', [lastId]);
  if (notif) {
    pgQuery(`
      INSERT INTO notifications (id, patient_id, visit_id, appointment_id, channel, recipient, subject, content, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [notif.id, notif.patient_id, notif.visit_id, notif.appointment_id, notif.channel, notif.recipient, notif.subject, notif.content, notif.status]);
  }
  return notif;
}

function getNotificationsByPatient(patientId) {
  return all('SELECT * FROM notifications WHERE patient_id = ? ORDER BY sent_at DESC', [patientId]);
}

function getNotificationById(id) {
  return get('SELECT * FROM notifications WHERE id = ?', [id]);
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  initDB,
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
  createNotification,
  getNotificationsByPatient,
  getNotificationById,
  MASTER_KEY,
};