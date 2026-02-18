const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { ensureAdmin } = require('../middleware/auth');

// GET /api/aircraft — list all aircraft
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM aircraft ORDER BY tail_number'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch aircraft' });
  }
});

// GET /api/aircraft/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM aircraft WHERE id = ?', [
      req.params.id,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ error: 'Aircraft not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch aircraft' });
  }
});

// POST /api/aircraft — add new aircraft (admin only)
router.post(
  '/',
  ensureAdmin,
  [
    body('tail_number').trim().notEmpty().withMessage('Tail number is required'),
    body('make').trim().notEmpty().withMessage('Make is required'),
    body('model').trim().notEmpty().withMessage('Model is required'),
    body('year').optional({ nullable: true }).isInt({ min: 1900, max: 2100 }).withMessage('Invalid year'),
    body('last_hobbs').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Invalid Hobbs value'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tail_number, make, model, year, last_hobbs } = req.body;

      const [existing] = await pool.query(
        'SELECT id FROM aircraft WHERE tail_number = ?',
        [tail_number]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Tail number already exists' });
      }

      const [result] = await pool.query(
        'INSERT INTO aircraft (tail_number, make, model, year, last_hobbs) VALUES (?, ?, ?, ?, ?)',
        [tail_number, make, model, year || null, last_hobbs || 0]
      );

      res.status(201).json({
        id: result.insertId,
        tail_number,
        make,
        model,
        year: year || null,
        last_hobbs: last_hobbs || 0,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to add aircraft' });
    }
  }
);

// PUT /api/aircraft/:id — edit aircraft (admin only)
router.put(
  '/:id',
  ensureAdmin,
  [
    body('tail_number').trim().notEmpty().withMessage('Tail number is required'),
    body('make').trim().notEmpty().withMessage('Make is required'),
    body('model').trim().notEmpty().withMessage('Model is required'),
    body('year').optional({ nullable: true }).isInt({ min: 1900, max: 2100 }).withMessage('Invalid year'),
    body('last_hobbs').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Invalid Hobbs value'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tail_number, make, model, year, last_hobbs } = req.body;

      const [rows] = await pool.query('SELECT id FROM aircraft WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Aircraft not found' });
      }

      // Check for duplicate tail number on a different aircraft
      const [dup] = await pool.query(
        'SELECT id FROM aircraft WHERE tail_number = ? AND id != ?',
        [tail_number, req.params.id]
      );
      if (dup.length > 0) {
        return res.status(409).json({ error: 'Tail number already in use by another aircraft' });
      }

      await pool.query(
        'UPDATE aircraft SET tail_number = ?, make = ?, model = ?, year = ?, last_hobbs = ? WHERE id = ?',
        [tail_number, make, model, year || null, last_hobbs != null ? last_hobbs : 0, req.params.id]
      );

      res.json({ message: 'Aircraft updated' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update aircraft' });
    }
  }
);

// DELETE /api/aircraft/:id — remove aircraft (admin only)
router.delete('/:id', ensureAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id FROM aircraft WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Aircraft not found' });
    }

    await pool.query('DELETE FROM aircraft WHERE id = ?', [req.params.id]);
    res.json({ message: 'Aircraft deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete aircraft' });
  }
});

module.exports = router;
