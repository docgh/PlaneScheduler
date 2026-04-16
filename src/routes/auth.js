const router = require('express').Router();
const bcrypt = require('bcryptjs');
const passport = require('../config/passport');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');

// POST /auth/login
router.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true,
  })
);

// POST /auth/register
router.post(
  '/register',
  [
    body('username')
      .trim()
      .isLength({ min: 3, max: 50 })
      .withMessage('Username must be 3-50 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match');
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map((e) => e.msg).join(', '));
      return res.redirect('/register');
    }

    try {
      const { username, email, password } = req.body;

      // Check if user exists
      const [existing] = await pool.query(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [username, email]
      );
      if (existing.length > 0) {
        req.flash('error', 'Username or email already in use');
        return res.redirect('/register');
      }

      const hashed = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO users (username, password, email, privileges) VALUES (?, ?, ?, ?)',
        [username, hashed, email, 'pending']
      );

      req.flash('success', 'Registration submitted — an administrator must approve your account before you can log in');
      res.redirect('/login');
    } catch (err) {
      console.error('Registration error:', err);
      req.flash('error', 'Registration failed');
      res.redirect('/register');
    }
  }
);

// POST /auth/logout
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'Logged out');
    res.redirect('/login');
  });
});

// POST /auth/change-password
router.post(
  '/change-password',
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { currentPassword, newPassword } = req.body;

      const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const match = await bcrypt.compare(currentPassword, rows[0].password);
      if (!match) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      console.error('Password change error:', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

module.exports = router;
