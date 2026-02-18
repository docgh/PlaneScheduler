const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');

// GET /api/users/pending — list pending users
router.get('/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, username, email, created_at FROM users WHERE privileges = 'pending' ORDER BY created_at"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending users' });
  }
});

// GET /api/users — list all users (for admin management)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, privileges, created_at FROM users ORDER BY username'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users — create a new user (admin only)
router.post(
  '/',
  [
    body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('privileges').isIn(['admin', 'maintainer', 'user', 'pending']).withMessage('Invalid privilege level'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { username, email, password, privileges } = req.body;

      const [existing] = await pool.query(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [username, email]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Username or email already in use' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        'INSERT INTO users (username, password, email, privileges) VALUES (?, ?, ?, ?)',
        [username, hashed, email, privileges]
      );

      res.status(201).json({
        id: result.insertId,
        username,
        email,
        privileges,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// PUT /api/users/:id — edit a user (admin only)
router.put(
  '/:id',
  [
    body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('privileges').isIn(['admin', 'maintainer', 'user', 'pending']).withMessage('Invalid privilege level'),
    body('password').optional({ nullable: true, checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const userId = parseInt(req.params.id, 10);
      const { username, email, privileges, password } = req.body;

      const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Prevent admin from changing own privileges
      if (userId === req.user.id && privileges !== 'admin') {
        return res.status(400).json({ error: 'Cannot change your own privileges' });
      }

      // Check for duplicate username/email on different user
      const [dup] = await pool.query(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
        [username, email, userId]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: 'Username or email already in use' });
      }

      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
          'UPDATE users SET username = ?, email = ?, privileges = ?, password = ? WHERE id = ?',
          [username, email, privileges, hashed, userId]
        );
      } else {
        await pool.query(
          'UPDATE users SET username = ?, email = ?, privileges = ? WHERE id = ?',
          [username, email, privileges, userId]
        );
      }

      res.json({ message: 'User updated' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// PATCH /api/users/:id — update user privileges
router.patch('/:id', async (req, res) => {
  try {
    const { privileges } = req.body;
    const valid = ['admin', 'maintainer', 'user', 'pending'];
    if (!valid.includes(privileges)) {
      return res.status(400).json({ error: 'Invalid privilege level' });
    }

    // Prevent admin from demoting themselves
    if (parseInt(req.params.id, 10) === req.user.id && privileges !== 'admin') {
      return res.status(400).json({ error: 'Cannot change your own privileges' });
    }

    const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query('UPDATE users SET privileges = ? WHERE id = ?', [privileges, req.params.id]);
    res.json({ message: 'User privileges updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — delete a user
router.delete('/:id', async (req, res) => {
  try {
    if (parseInt(req.params.id, 10) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
