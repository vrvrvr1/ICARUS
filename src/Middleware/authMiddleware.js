export const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
};

// Require that the logged-in user is not banned or currently suspended.
// If the request expects JSON (AJAX), return JSON error; otherwise return a 403 text response.
import db from "../database/db.js";

export const requireActiveUser = async (req, res, next) => {
  const user = req.session && req.session.user;
  if (!user) return res.redirect('/login');

  try {
    // Re-check authoritative state from DB in case admin changed status while session active
    try {
      const q = await db.query('SELECT is_banned, suspended_until FROM customers WHERE id = $1', [user.id]);
      if (q.rows && q.rows.length) {
        const dbUser = q.rows[0];
        // sync session with DB values where present
        if (typeof dbUser.is_banned !== 'undefined') req.session.user.is_banned = dbUser.is_banned;
        if (dbUser.suspended_until) req.session.user.suspended_until = dbUser.suspended_until;
      }
    } catch (dbErr) {
      // If DB check fails, log but continue using session values (defensive)
      console.error('requireActiveUser DB check failed:', dbErr);
    }

    if (req.session.user && req.session.user.is_banned) {
      if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.indexOf('application/json') !== -1)) {
        return res.status(403).json({ error: 'account_banned', message: 'Your account has been banned.' });
      }
      return res.status(403).send('Your account has been banned. Contact support.');
    }

    if (req.session.user && req.session.user.suspended_until) {
      const suspendedUntil = new Date(req.session.user.suspended_until);
      if (!isNaN(suspendedUntil) && new Date() < suspendedUntil) {
        if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.indexOf('application/json') !== -1)) {
          return res.status(403).json({ error: 'account_suspended', suspended_until: req.session.user.suspended_until });
        }
        return res.status(403).send('Your account is suspended until ' + suspendedUntil.toLocaleString());
      }
    }
  } catch (err) {
    // Fall through to allow access on unexpected errors (defensive)
    console.error('requireActiveUser check failed:', err);
  }

  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("❌ Access denied");
  }
  next();
};
