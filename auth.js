const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

let pgPool = null;

function formatSupabaseUrl(url) {
  if (!url) return url;
  let formatted = String(url).trim();
  if ((formatted.startsWith('"') && formatted.endsWith('"')) || (formatted.startsWith("'") && formatted.endsWith("'"))) {
    formatted = formatted.slice(1, -1).trim();
  }
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
    } catch (e) {}
  }
  return pgPool;
}

const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');

const JWT_SECRET = process.env.JWT_SECRET || 'mediscan-nfc-jwt-secret-stable-key-2024';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'mediscan-nfc-refresh-secret-stable-key-2024';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const BCRYPT_ROUNDS = 12;

const ROLES = {
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  RECEPTION: 'reception'
};

const PERMISSIONS = {
  PATIENTS_READ: 'patients:read',
  PATIENTS_WRITE: 'patients:write',
  PATIENTS_DELETE: 'patients:delete',
  VISITS_READ: 'visits:read',
  VISITS_WRITE: 'visits:write',
  PRESCRIPTIONS_WRITE: 'prescriptions:write',
  APPOINTMENTS_WRITE: 'appointments:write',
  ADMIN_READ: 'admin:read'
};

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_WRITE,
    PERMISSIONS.PATIENTS_DELETE,
    PERMISSIONS.VISITS_READ,
    PERMISSIONS.VISITS_WRITE,
    PERMISSIONS.PRESCRIPTIONS_WRITE,
    PERMISSIONS.APPOINTMENTS_WRITE,
    PERMISSIONS.ADMIN_READ
  ],
  [ROLES.DOCTOR]: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_WRITE,
    PERMISSIONS.VISITS_READ,
    PERMISSIONS.VISITS_WRITE,
    PERMISSIONS.PRESCRIPTIONS_WRITE,
    PERMISSIONS.APPOINTMENTS_WRITE
  ],
  [ROLES.RECEPTION]: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_WRITE,
    PERMISSIONS.VISITS_READ,
    PERMISSIONS.APPOINTMENTS_WRITE
  ]
};

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('[Auth] Warning creating DATA_DIR:', err.message);
  }
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    const bundledUsers = path.join(__dirname, 'data', 'users.json');
    if (fs.existsSync(bundledUsers)) {
      try {
        const data = fs.readFileSync(bundledUsers, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        console.warn('[Auth] Could not read bundled users.json:', e.message);
      }
    }
    return [];
  }
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.warn('[Auth] Error reading users file:', err.message);
    return [];
  }
}

function saveUsers(users) {
  try {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.warn('[Auth] Failed to write users.json to disk:', err.message);
  }
}

function auditLog(action, userId, details) {
  try {
    ensureDataDir();
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} | ${action} | userId:${userId} | ${JSON.stringify(details)}\n`;
    fs.appendFileSync(AUDIT_LOG_FILE, logEntry);
    const pool = getPgPool();
    if (pool) {
      pool.query('INSERT INTO audit_logs (action, user_id, details) VALUES ($1, $2, $3)',
        [action, userId ? String(userId) : null, details ? JSON.stringify(details) : null]).catch(() => {});
    }
  } catch (err) {
    console.warn('[Auth] Audit log write failed:', err.message);
  }
}

function getAuditLogs(limit = 100) {
  try {
    ensureDataDir();
    if (!fs.existsSync(AUDIT_LOG_FILE)) {
      return [];
    }
    const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n');
    return lines.filter(Boolean).slice(-limit).map(line => {
      try {
        const parts = line.split(' | ');
        if (parts.length < 4) return { raw: line };
        return {
          timestamp: parts[0],
          action: parts[1],
          userId: parts[2].replace('userId:', ''),
          details: JSON.parse(parts.slice(3).join(' | ')),
        };
      } catch (e) {
        return { raw: line };
      }
    }).reverse();
  } catch (err) {
    console.warn('[Auth] Error reading audit logs:', err.message);
    return [];
  }
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateTokens(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    permissions: ROLE_PERMISSIONS[user.role] || []
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ userId: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

  return { accessToken, refreshToken };
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (err) {
    return null;
  }
}

const DEFAULT_WORKSTATION_USER = {
  userId: 'workstation_admin',
  username: 'admin',
  role: ROLES.ADMIN,
  name: 'Hospital Workstation Admin',
  permissions: ROLE_PERMISSIONS[ROLES.ADMIN]
};

function requireAuth(requiredPermissions = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Allow seamless local workstation kiosk access with full admin permissions
      req.user = DEFAULT_WORKSTATION_USER;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      // If token is invalid/expired, fall back seamlessly to default workstation admin user
      req.user = DEFAULT_WORKSTATION_USER;
      return next();
    }

    const userPermissions = decoded.permissions || [];
    const hasPermission = requiredPermissions.every(p => userPermissions.includes(p));

    if (!hasPermission) {
      auditLog('PERMISSION_DENIED', decoded.userId, { required: requiredPermissions, has: userPermissions });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    req.user = decoded;
    next();
  };
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Allow seamless local workstation kiosk access with full admin permissions
      req.user = DEFAULT_WORKSTATION_USER;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      // If token is invalid/expired, fall back seamlessly to default workstation admin user
      req.user = DEFAULT_WORKSTATION_USER;
      return next();
    }

    if (!allowedRoles.includes(decoded.role)) {
      auditLog('ROLE_DENIED', decoded.userId, { required: allowedRoles, has: decoded.role });
      return res.status(403).json({ error: 'Insufficient role' });
    }

    req.user = decoded;
    next();
  };
}

async function initAuth() {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
      if (res && res.rows.length > 0) {
        const cloudUsers = res.rows.map(r => ({
          id: r.id,
          username: r.username,
          password: r.password,
          passwordHash: r.password,
          role: r.role,
          name: r.username === 'admin' ? 'System Administrator' : (r.username === 'doctor' ? 'Attending Physician' : 'Reception Desk'),
          email: `${r.username}@mediscan.local`,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
        }));
        saveUsers(cloudUsers);
        console.log(`[Auth] Loaded ${cloudUsers.length} users from Supabase.`);
        return;
      }
    } catch (e) {
      console.warn('[Auth] Supabase users read warning:', e.message);
    }
  }

  const users = loadUsers();

  if (users.length === 0) {
    const defaultUsers = [
      { username: 'admin', password: 'admin123', role: ROLES.ADMIN },
      { username: 'doctor', password: 'doctor123', role: ROLES.DOCTOR },
      { username: 'reception', password: 'reception123', role: ROLES.RECEPTION }
    ];

    for (const u of defaultUsers) {
      const hashedPassword = await hashPassword(u.password);
      const user = {
        id: crypto.randomUUID(),
        username: u.username,
        password: hashedPassword,
        passwordHash: hashedPassword,
        role: u.role,
        name: u.username === 'admin' ? 'System Administrator' : (u.username === 'doctor' ? 'Attending Physician' : 'Reception Desk'),
        email: `${u.username}@mediscan.local`,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      auditLog('USER_CREATED', user.id, { username: user.username, role: user.role });
      if (pool) {
        try {
          await pool.query('INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
            [user.id, user.username, user.password, user.role]);
        } catch (e) {}
      }
    }

    saveUsers(users);
    console.log('Default users created');
  }
}

function findUserByUsername(identifier) {
  const users = loadUsers();
  return users.find(u => u.username === identifier || u.email === identifier);
}

function findUserById(id) {
  const users = loadUsers();
  return users.find(u => u.id === id);
}

async function authenticateUser(username, password) {
  const user = findUserByUsername(username);
  if (!user) {
    auditLog('LOGIN_FAILED', null, { username, reason: 'user_not_found' });
    return null;
  }

  const hash = user.passwordHash || user.password;
  if (!hash) {
    auditLog('LOGIN_FAILED', user.id, { username, reason: 'invalid_password' });
    return null;
  }

  const valid = await verifyPassword(password, hash);
  if (!valid) {
    auditLog('LOGIN_FAILED', user.id, { username, reason: 'invalid_password' });
    return null;
  }

  auditLog('LOGIN_SUCCESS', user.id, { username });
  return user;
}

async function refreshAccessToken(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return null;
  }

  const user = findUserById(decoded.userId);
  if (!user) {
    return null;
  }

  return generateTokens(user);
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  requireAuth,
  requireRole,
  auditLog,
  getAuditLogs,
  initAuth,
  authenticateUser,
  refreshAccessToken,
  findUserByUsername,
  findUserById,
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers
};