import express from 'express';
import db from '../database/db.js';

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// List saved addresses
router.get('/addresses', isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;
    const { rows } = await db.query(
      `SELECT id, label, first_name, last_name, phone, email, address_line, city, province, zipcode, is_default
       FROM addresses WHERE customer_id=$1
       ORDER BY is_default DESC, created_at DESC`,
      [customer_id]
    );
    res.json({ success: true, addresses: rows });
  } catch (err) {
    console.error('Addresses GET error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Create new address
router.post('/addresses', isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;
    const { label, first_name, last_name, phone, email, address_line, city, province, zipcode, is_default } = req.body;
    if (is_default) {
      await db.query('UPDATE addresses SET is_default=false WHERE customer_id=$1', [customer_id]);
    }
    const { rows } = await db.query(
      `INSERT INTO addresses (customer_id, label, first_name, last_name, phone, email, address_line, city, province, zipcode, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [customer_id, label || null, first_name || null, last_name || null, phone || null, email || null, address_line, city, province, zipcode, !!is_default]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('Addresses POST error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Set default address
router.put('/addresses/:id/default', isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;
    const { id } = req.params;
    await db.query('UPDATE addresses SET is_default=false WHERE customer_id=$1', [customer_id]);
    await db.query('UPDATE addresses SET is_default=true WHERE id=$1 AND customer_id=$2', [id, customer_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Addresses default PUT error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Delete address
router.delete('/addresses/:id', isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;
    const { id } = req.params;
    await db.query('DELETE FROM addresses WHERE id=$1 AND customer_id=$2', [id, customer_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Addresses DELETE error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
