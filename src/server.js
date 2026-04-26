require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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
const caldavRoutes = require('./routes/caldav');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth/login', loginLimiter);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Trust proxy if behind reverse proxy
if (isProduction) app.set('trust proxy', 1);

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
      secure: isProduction,
      httpOnly: true,
      sameSite: 'lax',
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
app.use('/caldav', caldavRoutes);

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
