const router = require('express').Router();
const { ensureAuthenticated } = require('../middleware/auth');

// Login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const loginImage = process.env.LOGIN_IMAGE || '/pics/login.jpg';
  res.render('login', { loginImage });
});

// Register page
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('register');
});

// Dashboard (main page)
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('dashboard');
});

module.exports = router;
