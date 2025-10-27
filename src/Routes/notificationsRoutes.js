import express from "express";
import db from "../database/db.js";

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

async function ensureNotificationsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.warn('Ensure notifications table failed:', e.message);
  }
}

// GET /notifications - list notifications for the current user
router.get('/notifications', isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  try {
    await ensureNotificationsTable();
    const result = await db.query(
      `SELECT id, title, body, link, is_read, created_at
         FROM user_notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [userId]
    );
    res.render('customer/notifications', { user: req.session.user, items: result.rows });
  } catch (e) {
    console.error('Notifications page error:', e);
    res.status(500).send('Error loading notifications');
  }
});

// GET /notifications/count - unread count (JSON)
router.get('/notifications/count', isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  try {
    await ensureNotificationsTable();
    const result = await db.query(
      `SELECT COUNT(*)::int AS count FROM user_notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (e) {
    console.error('Notifications count error:', e);
    res.json({ count: 0 });
  }
});

// POST /notifications/mark-read - mark all or specific notification as read
router.post('/notifications/mark-read', isAuthenticated, express.json(), async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.body || {};
  try {
    await ensureNotificationsTable();
    if (id && Number.isInteger(Number(id))) {
      await db.query(`UPDATE user_notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [Number(id), userId]);
    } else {
      await db.query(`UPDATE user_notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [userId]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Notifications mark-read error:', e);
    res.status(500).json({ ok: false });
  }
});

export default router;
