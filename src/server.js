require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const passport = require('./config/passport');
const { initializeDatabase } = require('./db/init');
const { ensureAuthenticated, ensureAdmin } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const aircraftRoutes = require('./routes/aircraft');
const reservationRoutes = require('./routes/reservations');
const issueRoutes = require('./routes/issues');
const userRoutes = require('./routes/users');
const subscriptionRoutes = require('./routes/subscriptions');
const pageRoutes = require('./routes/pages');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  next();
});

// Routes
app.use('/', pageRoutes);
app.use('/auth', authRoutes);
app.use('/api/aircraft', ensureAuthenticated, aircraftRoutes);
app.use('/api/reservations', ensureAuthenticated, reservationRoutes);
app.use('/api/issues', ensureAuthenticated, issueRoutes);
app.use('/api/users', ensureAdmin, userRoutes);
app.use('/api/subscriptions', ensureAuthenticated, subscriptionRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`PlaneScheduler running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
