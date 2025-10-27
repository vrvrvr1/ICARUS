// routes/googleauthRoutes.js
import express from "express";
import passport from "passport";

const router = express.Router();

// Login route
router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Callback route
router.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    req.session.user = req.user;
    req.session.notice = `Welcome ${req.user.first_name || req.user.email || 'user'}!`;
    // Audit log (best-effort)
    (async () => {
      try {
        const dbmod = (await import("../database/db.js")).default;
        await dbmod.query(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NULL REFERENCES customers(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            meta JSONB NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        const meta = { method: 'google', email: req.user.email, ip: req.ip, ua: req.headers['user-agent'] };
        await dbmod.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [req.user.id, 'auth.login', JSON.stringify(meta)]);
      } catch(_) {}
    })();
    res.redirect("/");// redirect to home after login
  }
);

// Logout route
router.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

export default router;
