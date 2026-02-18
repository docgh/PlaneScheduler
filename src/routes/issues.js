const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { ensureAdminOrMaintainer } = require('../middleware/auth');

// GET /api/issues?aircraft_id=
router.get('/', async (req, res) => {
  try {
    const { aircraft_id } = req.query;
    let query = `
      SELECT i.*, a.tail_number, u.username AS reported_by_name
      FROM aircraft_issues i
      JOIN aircraft a ON i.aircraft_id = a.id
      JOIN users u ON i.reported_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (aircraft_id) {
      query += ' AND i.aircraft_id = ?';
      params.push(aircraft_id);
    }

    query += ' ORDER BY i.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// POST /api/issues
router.post(
  '/',
  [
    body('aircraft_id').isInt().withMessage('Aircraft is required'),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('severity')
      .isIn(['low', 'medium', 'high', 'grounding'])
      .withMessage('Invalid severity'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { aircraft_id, title, description, severity } = req.body;
      const [result] = await pool.query(
        `INSERT INTO aircraft_issues (aircraft_id, reported_by, title, description, severity)
         VALUES (?, ?, ?, ?, ?)`,
        [aircraft_id, req.user.id, title, description || null, severity]
      );

      res.status(201).json({
        id: result.insertId,
        aircraft_id,
        title,
        description,
        severity,
        status: 'open',
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create issue' });
    }
  }
);

// PATCH /api/issues/:id  — update status (admin/maintainer only)
router.patch('/:id', ensureAdminOrMaintainer, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const resolvedAt = status === 'resolved' ? new Date() : null;
    await pool.query(
      'UPDATE aircraft_issues SET status = ?, resolved_at = ? WHERE id = ?',
      [status, resolvedAt, req.params.id]
    );

    res.json({ message: 'Issue updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update issue' });
  }
});

// DELETE /api/issues/:id (admin/maintainer only)
router.delete('/:id', ensureAdminOrMaintainer, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM aircraft_issues WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: 'Issue not found' });

    await pool.query('DELETE FROM aircraft_issues WHERE id = ?', [
      req.params.id,
    ]);
    res.json({ message: 'Issue deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete issue' });
  }
});

module.exports = router;
