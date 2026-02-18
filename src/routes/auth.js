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

// GET /auth/logout
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'Logged out');
    res.redirect('/login');
  });
});

module.exports = router;
