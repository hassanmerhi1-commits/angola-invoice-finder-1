// Authentication routes
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireAuth } = require('../middleware/requireAuth');
const { loginRateLimiter } = require('../middleware/loginRateLimit');
const {
  hashPassword,
  upgradePasswordHashIfLegacy,
  verifyPasswordWithDummyFallback,
} = require('../lib/passwordAuth');
const { findUserForLogin } = require('../lib/loginUserLookup');

const router = express.Router();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function mapUserRow(user) {
  const email = String(user.email || '').toLowerCase();
  const username =
    user.username
    || (email.includes('@') ? email.split('@')[0] : email);
  return {
    id: user.id,
    email: user.email,
    username,
    name: user.name,
    role: user.role,
    branchId: user.branch_id,
    isActive: user.is_active === true || user.is_active === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function normalizeUserIdentity(emailRaw, usernameRaw) {
  const emailIn = String(emailRaw || '').trim().toLowerCase();
  const userIn = String(usernameRaw || '').trim().toLowerCase();
  const username = userIn || (emailIn.includes('@') ? emailIn.split('@')[0] : emailIn);
  const email = emailIn.includes('@') ? emailIn : `${username}@kwanzaerp.ao`;
  return { email, username };
}

function normalizeLoginEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('@')) return value;
  return `${value}@kwanzaerp.ao`;
}

function issueToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

// Login — public, rate-limited
router.post('/login', loginRateLimiter(), async (req, res) => {
  try {
    const rawIdentifier = req.body?.email ?? req.body?.username ?? '';
    const password = req.body?.password;

    if (!String(rawIdentifier).trim()) {
      return res.status(400).json({ error: 'Email or username is required' });
    }
    if (password == null || String(password).length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = await findUserForLogin(db, rawIdentifier);
    const validPassword = await verifyPasswordWithDummyFallback(password, user?.password_hash);

    if (!user || !validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await upgradePasswordHashIfLegacy(db, user.id, password, user.password_hash);

    const token = issueToken(user);

    res.json({
      token,
      user: mapUserRow(user),
    });
  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Current session — requires JWT
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, role, branch_id, is_active, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json(mapUserRow(result.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] me:', error);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// User management — admin only
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at
       FROM users
       ORDER BY name`,
    );
    res.json(result.rows.map(mapUserRow));
  } catch (error) {
    console.error('[AUTH ERROR] list users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, name, role, branchId, password, username } = req.body;
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name and role are required' });
    }

    const { email: normalizedEmail, username: normalizedUsername } = normalizeUserIdentity(email, username);
    const plainPassword = password != null && String(password).length > 0 ? String(password) : null;
    if (!plainPassword || plainPassword.length < 8) {
      return res.status(400).json({ error: 'Password is required (minimum 8 characters)' });
    }

    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    try {
      const dupUser = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [normalizedUsername]);
      if (dupUser.rows.length > 0) {
        return res.status(409).json({ error: 'Username already in use' });
      }
    } catch (_) {
      /* username column may be missing on very old DBs */
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(plainPassword);

    await db.query(
      `INSERT INTO users (id, email, username, name, role, branch_id, password_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, normalizedEmail, normalizedUsername, name, role, branchId || null, passwordHash],
    );

    const created = await db.query(
      'SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    res.status(201).json(mapUserRow(created.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] create user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, role, branchId, isActive, password, username } = req.body;

    const existing = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let normalizedEmail = null;
    let normalizedUsername = null;
    if (email != null || username != null) {
      const identity = normalizeUserIdentity(
        email != null ? email : '',
        username != null ? username : '',
      );
      normalizedEmail = email != null ? identity.email : null;
      normalizedUsername = username != null || email != null ? identity.username : null;
    }

    if (normalizedEmail) {
      const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2', [
        normalizedEmail,
        id,
      ]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    if (normalizedUsername) {
      try {
        const dupUser = await db.query('SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2', [
          normalizedUsername,
          id,
        ]);
        if (dupUser.rows.length > 0) {
          return res.status(409).json({ error: 'Username already in use' });
        }
      } catch (_) {}
    }

    let passwordHash;
    if (password != null && String(password).length > 0) {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      passwordHash = await hashPassword(String(password));
    }

    await db.query(
      `UPDATE users SET
         email = COALESCE($2, email),
         username = COALESCE($3, username),
         name = COALESCE($4, name),
         role = COALESCE($5, role),
         branch_id = COALESCE($6, branch_id),
         is_active = COALESCE($7, is_active),
         password_hash = COALESCE($8, password_hash),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        normalizedEmail,
        normalizedUsername,
        name || null,
        role || null,
        branchId !== undefined ? branchId : null,
        isActive !== undefined ? isActive : null,
        passwordHash || null,
      ],
    );

    const updated = await db.query(
      'SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    res.json(mapUserRow(updated.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] update user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH ERROR] delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
