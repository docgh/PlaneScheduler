const nodemailer = require('nodemailer');
const pool = require('../config/db');

const skipAuth = process.env.SMTP_NO_AUTH === 'true';
const ignoreTLS = process.env.SMTP_IGNORE_TLS === 'true';

const transportOpts = {
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  tls: { rejectUnauthorized: ignoreTLS ? false : true },
};

if (!skipAuth) {
  transportOpts.auth = {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  };
}

const transporter = nodemailer.createTransport(transportOpts);

/**
 * Notify subscribed users about a reservation change for an aircraft
 */
async function notifyNewReservation(reservation, aircraft, bookedBy) {
  try {
    const [users] = await pool.query(
      `SELECT u.email, u.username FROM users u
       INNER JOIN user_aircraft_subscriptions s ON u.id = s.user_id
       WHERE s.aircraft_id = ?`,
      [aircraft.id]
    );
    if (users.length === 0) return;

    const recipients = users.map((u) => u.email).join(', ');
    const startDate = new Date(reservation.start_time).toLocaleString();
    const endDate = new Date(reservation.end_time).toLocaleString();

    const mailOptions = {
      from: process.env.SMTP_FROM || 'PlaneScheduler <noreply@example.com>',
      to: recipients,
      subject: `${reservation.title} Reservation: ${aircraft.tail_number}`,
      html: `
        <h2>New Aircraft Reservation</h2>
        <table style="border-collapse:collapse; font-family:Arial,sans-serif;">
          <tr><td style="padding:4px 12px;font-weight:bold;">Type:</td><td style="padding:4px 12px;">${reservation.title}</td></tr>
          <tr><td style="padding:4px 12px;font-weight:bold;">Aircraft:</td><td style="padding:4px 12px;">${aircraft.tail_number} (${aircraft.make} ${aircraft.model})</td></tr>
          <tr><td style="padding:4px 12px;font-weight:bold;">Reserved by:</td><td style="padding:4px 12px;">${bookedBy}</td></tr>
          <tr><td style="padding:4px 12px;font-weight:bold;">Start:</td><td style="padding:4px 12px;">${startDate}</td></tr>
          <tr><td style="padding:4px 12px;font-weight:bold;">End:</td><td style="padding:4px 12px;">${endDate}</td></tr>
          ${reservation.notes ? `<tr><td style="padding:4px 12px;font-weight:bold;">Notes:</td><td style="padding:4px 12px;">${reservation.notes}</td></tr>` : ''}
        </table>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Reservation notification sent to ${users.length} subscribed user(s)`);
  } catch (err) {
    // Don't fail the reservation if email fails
    console.error('Email notification error:', err.message);
  }
}

module.exports = { notifyNewReservation };
