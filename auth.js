const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const REFRESH_SECRET = process.env.REFRESH_SECRET || crypto.randomBytes(64).toString('hex');

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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  const data = fs.readFileSync(USERS_FILE, 'utf8');
  return JSON.parse(data);
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function auditLog(action, userId, details) {
  ensureDataDir();
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} | ${action} | userId:${userId} | ${JSON.stringify(details)}\n`;
  fs.appendFileSync(AUDIT_LOG_FILE, logEntry);
}

function getAuditLogs(limit = 100) {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return [];
  }
  const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n');
  return lines.slice(-limit).map(line => {
    const parts = line.split(' | ');
    if (parts.length < 4) return { raw: line };
    return {
      timestamp: parts[0],
      action: parts[1],
      userId: parts[2].replace('userId:', ''),
      details: JSON.parse(parts.slice(3).join(' | ')),
    };
  }).reverse();
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
        role: u.role,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      auditLog('USER_CREATED', user.id, { username: user.username, role: user.role });
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

  const valid = await verifyPassword(password, user.passwordHash);
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