const path = require('path');
const router = require('express').Router();
const { ensureAuthenticated, ensureAdminOrMaintainer } = require('../middleware/auth');

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

// Settings page
router.get('/settings', ensureAuthenticated, (req, res) => {
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const detectedProtocol = forwardedProto || req.protocol;
  const protocol = detectedProtocol === 'http' ? 'https' : detectedProtocol;
  const host = forwardedHost || req.get('host');
  const username = encodeURIComponent(req.user.username);
  const caldavUrl = `${protocol}://${host}/caldav/calendars/${username}/reservations`;
  res.render('settings', { caldavUrl });
});

// Admin page
router.get('/admin', ensureAdminOrMaintainer, (req, res) => {
  res.render('admin');
});

// Performance tool (public)
router.get('/perf', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tools', 'E90_Runway_Analysis.html'));
});

module.exports = router;
