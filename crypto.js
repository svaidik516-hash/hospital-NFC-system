const crypto = require('crypto');

const ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a key from master key using PBKDF2 with a per-record salt
 * @param {Buffer} masterKey - 32-byte master key
 * @param {Buffer} salt - Per-record salt
 * @returns {Buffer} Derived 32-byte key
 */
function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Gets the master key from environment or derives from fallback
 * @returns {Buffer} 32-byte master key
 */
function getMasterKey() {
  const envKey = process.env.MASTER_ENCRYPTION_KEY;
  if (envKey) {
    const key = Buffer.from(envKey, 'hex');
    if (key.length !== KEY_LENGTH) {
      throw new Error(`MASTER_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars)`);
    }
    return key;
  }
  // Fallback: derive from a static string (NOT for production use)
  const fallback = 'fallback-master-key-change-in-production';
  return crypto.scryptSync(fallback, 'fixed-salt', KEY_LENGTH);
}

/**
 * Encrypts data using AES-256-GCM
 * @param {string|Buffer} data - Data to encrypt
 * @param {Buffer} [masterKey] - Optional master key (defaults to env/fallback)
 * @returns {Object} { ciphertext, iv, salt, authTag } all as hex strings
 */
function encrypt(data, masterKey = getMasterKey()) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

  const ciphertext = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypts data using AES-256-GCM
 * @param {Object} encrypted - { ciphertext, iv, salt, authTag } as hex strings
 * @param {Buffer} [masterKey] - Optional master key (defaults to env/fallback)
 * @returns {string} Decrypted data as UTF-8 string
 */
function decrypt(encrypted, masterKey = getMasterKey()) {
  const { ciphertext, iv, salt, authTag } = encrypted;

  const key = deriveKey(masterKey, Buffer.from(salt, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

/**
 * Encrypts a single field value
 * @param {string} value - Value to encrypt
 * @param {Buffer} [masterKey] - Optional master key
 * @returns {string} Encrypted value as JSON string
 */
function encryptField(value, masterKey) {
  return JSON.stringify(encrypt(value, masterKey));
}

/**
 * Decrypts a single field value
 * @param {string} encryptedJson - Encrypted value as JSON string
 * @param {Buffer} [masterKey] - Optional master key
 * @returns {string} Decrypted value
 */
function decryptField(encryptedJson, masterKey) {
  const encrypted = JSON.parse(encryptedJson);
  return decrypt(encrypted, masterKey);
}

/**
 * Encrypts specified fields in an object
 * @param {Object} obj - Object to encrypt
 * @param {string[]} fields - Array of field names to encrypt
 * @param {Buffer} [masterKey] - Optional master key
 * @returns {Object} New object with specified fields encrypted
 */
function encryptObject(obj, fields, masterKey) {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = encryptField(result[field], masterKey);
    }
  }
  return result;
}

/**
 * Decrypts specified fields in an object
 * @param {Object} obj - Object with encrypted fields
 * @param {string[]} fields - Array of field names to decrypt
 * @param {Buffer} [masterKey] - Optional master key
 * @returns {Object} New object with specified fields decrypted
 */
function decryptObject(obj, fields, masterKey) {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = decryptField(result[field], masterKey);
    }
  }
  return result;
}

/**
 * Check if a value is already encrypted (has the encrypted object structure)
 * @param {string|*} value - Value to check
 * @returns {boolean} True if value appears to be encrypted
 */
function isEncrypted(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value);
    return parsed &&
           typeof parsed.ciphertext === 'string' &&
           typeof parsed.iv === 'string' &&
           typeof parsed.salt === 'string' &&
           typeof parsed.authTag === 'string';
  } catch {
    return false;
  }
}

/**
 * Decrypt patient data fields
 * @param {Object} patient - Patient record
 * @returns {Object} Patient with decrypted sensitive fields
 */
function decryptPatientData(patient) {
  const sensitive = ['allergies', 'chronic_conditions', 'insurance_id', 'address',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation'];
  const result = { ...patient };
  for (const field of sensitive) {
    if (result[field] && isEncrypted(result[field])) {
      try {
        result[field] = decryptField(result[field]);
      } catch (e) {
        console.warn(`Failed to decrypt patient field ${field}:`, e.message);
      }
    }
  }
  return result;
}

/**
 * Decrypt visit data fields
 * @param {Object} visit - Visit record
 * @returns {Object} Visit with decrypted sensitive fields
 */
function decryptVisitData(visit) {
  const sensitive = ['diagnosis', 'symptoms', 'vitals', 'notes'];
  const result = { ...visit };
  for (const field of sensitive) {
    if (result[field] && isEncrypted(result[field])) {
      try {
        result[field] = decryptField(result[field]);
      } catch (e) {
        console.warn(`Failed to decrypt visit field ${field}:`, e.message);
      }
    }
  }
  return result;
}

/**
 * Decrypt prescription data fields
 * @param {Object} prescription - Prescription record
 * @returns {Object} Prescription with decrypted sensitive fields
 */
function decryptPrescriptionData(prescription) {
  const sensitive = ['medicine_name', 'dosage', 'frequency', 'duration', 'instructions'];
  const result = { ...prescription };
  for (const field of sensitive) {
    if (result[field] && isEncrypted(result[field])) {
      try {
        result[field] = decryptField(result[field]);
      } catch (e) {
        console.warn(`Failed to decrypt prescription field ${field}:`, e.message);
      }
    }
  }
  return result;
}

/**
 * Decrypt lab report data fields
 * @param {Object} labReport - Lab report record
 * @returns {Object} Lab report with decrypted sensitive fields
 */
function decryptLabReportData(labReport) {
  const sensitive = ['test_name', 'result', 'normal_range', 'notes'];
  const result = { ...labReport };
  for (const field of sensitive) {
    if (result[field] && isEncrypted(result[field])) {
      try {
        result[field] = decryptField(result[field]);
      } catch (e) {
        console.warn(`Failed to decrypt lab report field ${field}:`, e.message);
      }
    }
  }
  return result;
}

module.exports = {
  encrypt,
  decrypt,
  encryptField,
  decryptField,
  encryptObject,
  decryptObject,
  getMasterKey,
  deriveKey,
  isEncrypted,
  decryptPatientData,
  decryptVisitData,
  decryptPrescriptionData,
  decryptLabReportData,
  ITERATIONS,
  KEY_LENGTH,
  IV_LENGTH,
  SALT_LENGTH,
  AUTH_TAG_LENGTH
};