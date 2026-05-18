// Authentication routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');

function mapUserRow(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    branchId: user.branch_id,
    isActive: user.is_active === true || user.is_active === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // For demo: accept any password, or check hash
    // const validPassword = await bcrypt.compare(password, user.password_hash);
    const validPassword = true; // Demo mode
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchId: user.branch_id,
        isActive: user.is_active,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branch_id,
      isActive: user.is_active,
      createdAt: user.created_at
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// List users (user management)
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, name, role, branch_id, is_active, created_at, updated_at
       FROM users
       ORDER BY name`
    );
    res.json(result.rows.map(mapUserRow));
  } catch (error) {
    console.error('[AUTH ERROR] list users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user
router.post('/users', async (req, res) => {
  try {
    const { email, name, role, branchId, password } = req.body;
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name and role are required' });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const id = crypto.randomUUID();
    const passwordHash = password
      ? await bcrypt.hash(String(password), 10)
      : await bcrypt.hash('changeme', 10);

    await db.query(
      `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, email, name, role, branchId || null, passwordHash]
    );

    const created = await db.query(
      'SELECT id, email, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    res.status(201).json(mapUserRow(created.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] create user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, role, branchId, isActive, password } = req.body;

    const existing = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (email) {
      const dup = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    let passwordHash;
    if (password) {
      passwordHash = await bcrypt.hash(String(password), 10);
    }

    await db.query(
      `UPDATE users SET
         email = COALESCE($2, email),
         name = COALESCE($3, name),
         role = COALESCE($4, role),
         branch_id = COALESCE($5, branch_id),
         is_active = COALESCE($6, is_active),
         password_hash = COALESCE($7, password_hash),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        email || null,
        name || null,
        role || null,
        branchId !== undefined ? branchId : null,
        isActive !== undefined ? isActive : null,
        passwordHash || null,
      ]
    );

    const updated = await db.query(
      'SELECT id, email, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    res.json(mapUserRow(updated.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] update user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Soft-delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
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
