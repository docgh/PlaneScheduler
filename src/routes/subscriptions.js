const router = require('express').Router();
const pool = require('../config/db');

// GET /api/subscriptions — list aircraft IDs the current user is subscribed to
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT aircraft_id FROM user_aircraft_subscriptions WHERE user_id = ?',
      [req.user.id]
    );
    res.json(rows.map(r => r.aircraft_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// POST /api/subscriptions/:aircraftId — subscribe to an aircraft
router.post('/:aircraftId', async (req, res) => {
  try {
    const aircraftId = parseInt(req.params.aircraftId, 10);

    // Verify aircraft exists
    const [ac] = await pool.query('SELECT id FROM aircraft WHERE id = ?', [aircraftId]);
    if (ac.length === 0) {
      return res.status(404).json({ error: 'Aircraft not found' });
    }

    await pool.query(
      'INSERT IGNORE INTO user_aircraft_subscriptions (user_id, aircraft_id) VALUES (?, ?)',
      [req.user.id, aircraftId]
    );
    res.json({ subscribed: true, aircraft_id: aircraftId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// DELETE /api/subscriptions/:aircraftId — unsubscribe from an aircraft
router.delete('/:aircraftId', async (req, res) => {
  try {
    const aircraftId = parseInt(req.params.aircraftId, 10);
    await pool.query(
      'DELETE FROM user_aircraft_subscriptions WHERE user_id = ? AND aircraft_id = ?',
      [req.user.id, aircraftId]
    );
    res.json({ subscribed: false, aircraft_id: aircraftId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

module.exports = router;
