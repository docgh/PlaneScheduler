const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE username = ?',
        [username]
      );
      if (rows.length === 0) {
        return done(null, false, { message: 'Invalid username or password' });
      }
      const user = rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return done(null, false, { message: 'Invalid username or password' });
      }
      if (user.privileges === 'pending') {
        return done(null, false, { message: 'Your account is pending approval by an administrator' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.query('SELECT id, username, email, privileges FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return done(null, false);
    done(null, rows[0]);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
