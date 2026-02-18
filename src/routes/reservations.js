const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { notifyNewReservation } = require('../services/email');

// GET /api/reservations/usage-csv?aircraft_id=&start=&end=
router.get('/usage-csv', async (req, res) => {
  try {
    // Only admin or maintainer
    if (req.user.privileges !== 'admin' && req.user.privileges !== 'maintainer') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { aircraft_id, start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    let query = `
      SELECT r.id, a.tail_number, a.make, a.model, u.username, r.title AS type,
             r.start_time, r.end_time, r.start_hobbs, r.end_hobbs,
             (r.end_hobbs - r.start_hobbs) AS hobbs_used, r.completed_at, r.notes
      FROM reservations r
      JOIN aircraft a ON r.aircraft_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE r.completed_at IS NOT NULL
        AND r.start_time >= ? AND r.end_time <= ?
    `;
    const params = [start, end];

    if (aircraft_id) {
      query += ' AND r.aircraft_id = ?';
      params.push(aircraft_id);
    }

    query += ' ORDER BY r.start_time';
    const [rows] = await pool.query(query, params);

    // Build CSV
    const headers = ['ID', 'Tail Number', 'User', 'Type', 'Start', 'End', 'Hobbs Start', 'Hobbs End', 'Hobbs Used', 'Completed', 'Notes'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const line = [
        r.id,
        `"${r.tail_number}"`,
        `"${r.username}"`,
        `"${r.type}"`,
        `"${new Date(r.start_time).toISOString()}"`,
        `"${new Date(r.end_time).toISOString()}"`,
        r.start_hobbs ?? '',
        r.end_hobbs ?? '',
        r.hobbs_used ?? '',
        `"${new Date(r.completed_at).toISOString()}"`,
        `"${(r.notes || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(line.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="usage-report.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reservations?aircraft_id=&start=&end=
router.get('/', async (req, res) => {
  try {
    const { aircraft_id, start, end } = req.query;
    let query = `
      SELECT r.*, a.tail_number, a.make, a.model, a.last_hobbs, u.username
      FROM reservations r
      JOIN aircraft a ON r.aircraft_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (aircraft_id) {
      query += ' AND r.aircraft_id = ?';
      params.push(aircraft_id);
    }
    if (start) {
      query += ' AND r.end_time >= ?';
      params.push(start);
    }
    if (end) {
      query += ' AND r.start_time <= ?';
      params.push(end);
    }

    query += ' ORDER BY r.start_time';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// POST /api/reservations
router.post(
  '/',
  [
    body('aircraft_id').isInt().withMessage('Aircraft is required'),
    body('title').isIn(['Personal', 'Shared', 'Maintenance']).withMessage('Type must be Personal, Shared, or Maintenance'),
    body('start_time').isISO8601().withMessage('Valid start time required'),
    body('end_time').isISO8601().withMessage('Valid end time required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { aircraft_id, title, start_time, end_time, notes } = req.body;

      // Check for overlapping reservations
      const [conflicts] = await pool.query(
        `SELECT id FROM reservations
         WHERE aircraft_id = ? AND start_time < ? AND end_time > ?`,
        [aircraft_id, end_time, start_time]
      );
      if (conflicts.length > 0) {
        return res
          .status(409)
          .json({ error: 'Time slot conflicts with an existing reservation' });
      }

      const [result] = await pool.query(
        `INSERT INTO reservations (aircraft_id, user_id, title, start_time, end_time, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [aircraft_id, req.user.id, title, start_time, end_time, notes || null]
      );

      const reservation = {
        id: result.insertId,
        aircraft_id,
        title,
        start_time,
        end_time,
        notes,
      };

      // Fetch aircraft for email
      const [acRows] = await pool.query(
        'SELECT * FROM aircraft WHERE id = ?',
        [aircraft_id]
      );

      // Send notification (non-blocking)
      notifyNewReservation(reservation, acRows[0], req.user.username);

      res.status(201).json(reservation);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create reservation' });
    }
  }
);

// POST /api/reservations/:id/complete
router.post('/:id/complete', async (req, res) => {
  try {
    const { start_hobbs, end_hobbs } = req.body;

    if (start_hobbs == null || end_hobbs == null) {
      return res.status(400).json({ error: 'Hobbs start and end are required' });
    }
    if (isNaN(Number(start_hobbs)) || isNaN(Number(end_hobbs))) {
      return res.status(400).json({ error: 'Hobbs values must be numbers' });
    }
    if (Number(end_hobbs) < Number(start_hobbs)) {
      return res.status(400).json({ error: 'Hobbs end must be >= Hobbs start' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM reservations WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const reservation = rows[0];

    if (reservation.completed_at) {
      return res.status(400).json({ error: 'Reservation already completed' });
    }

    // Update reservation with hobbs and completed timestamp
    await pool.query(
      `UPDATE reservations
       SET start_hobbs = ?, end_hobbs = ?, completed_at = NOW()
       WHERE id = ?`,
      [start_hobbs, end_hobbs, req.params.id]
    );

    // Update aircraft lastHobbs
    await pool.query(
      'UPDATE aircraft SET last_hobbs = ? WHERE id = ?',
      [end_hobbs, reservation.aircraft_id]
    );

    res.json({ message: 'Reservation completed', start_hobbs, end_hobbs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to complete reservation' });
  }
});

// PUT /api/reservations/:id
router.put(
  '/:id',
  [
    body('aircraft_id').isInt().withMessage('Aircraft is required'),
    body('title').isIn(['Personal', 'Shared', 'Maintenance']).withMessage('Type must be Personal, Shared, or Maintenance'),
    body('start_time').isISO8601().withMessage('Valid start time required'),
    body('end_time').isISO8601().withMessage('Valid end time required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Reservation not found' });

      const reservation = rows[0];
      // Only owner or admin can edit
      if (reservation.user_id !== req.user.id && req.user.privileges !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      if (reservation.completed_at) {
        return res.status(400).json({ error: 'Cannot edit a completed reservation' });
      }

      const { aircraft_id, title, start_time, end_time, notes } = req.body;

      // Check for overlapping reservations (exclude this one)
      const [conflicts] = await pool.query(
        `SELECT id FROM reservations
         WHERE aircraft_id = ? AND start_time < ? AND end_time > ? AND id != ?`,
        [aircraft_id, end_time, start_time, req.params.id]
      );
      if (conflicts.length > 0) {
        return res.status(409).json({ error: 'Time slot conflicts with an existing reservation' });
      }

      await pool.query(
        `UPDATE reservations SET aircraft_id = ?, title = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ?`,
        [aircraft_id, title, start_time, end_time, notes || null, req.params.id]
      );

      res.json({ id: parseInt(req.params.id), aircraft_id, title, start_time, end_time, notes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update reservation' });
    }
  }
);

// DELETE /api/reservations/:id
router.delete('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM reservations WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Reservation not found' });

    // Only the owner or admin can delete
    if (rows[0].user_id !== req.user.id && req.user.privileges !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM reservations WHERE id = ?', [req.params.id]);
    res.json({ message: 'Reservation deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete reservation' });
  }
});

module.exports = router;
