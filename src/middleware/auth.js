function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // For API requests return 401, for pages redirect to login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.flash('error', 'Please log in to continue');
  res.redirect('/login');
}

/**
 * Middleware to require admin or maintainer privileges.
 */
function ensureAdminOrMaintainer(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.privileges === 'admin' || req.user.privileges === 'maintainer') {
    return next();
  }
  return res.status(403).json({ error: 'Insufficient privileges' });
}

/**
 * Middleware to require admin privileges.
 */
function ensureAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.privileges === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin privileges required' });
}

module.exports = { ensureAuthenticated, ensureAdminOrMaintainer, ensureAdmin };
