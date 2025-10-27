import bcrypt from "bcrypt";
import db from "../database/db.js";

export const login = async (req, res) => {
  const { email, password } = req.body;
  const emailNorm = (email || '').trim().toLowerCase();
  const passNorm = (password || '').trim();

  // 1. Basic validation
  if (!emailNorm || !passNorm) {
    return res.status(400).send("⚠️ Please enter both email and password.");
  }

  try {
    // 2. Find all users by email (handle duplicates gracefully)
    const result = await db.query(
      "SELECT * FROM customers WHERE LOWER(TRIM(email)) = $1 ORDER BY id DESC",
      [emailNorm]
    );

    if (result.rows.length === 0) {
      return res.status(400).render("customer/login", { notice: null, error: "❌ User not found." });
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[login] matches for ${emailNorm}:`, result.rows.map(r => ({ id: r.id, hasPassword: !!r.password, role: r.role })));
    }

    // 3. Compare bcrypt hash against any row with a password
    let authedUser = null;
    for (const row of result.rows) {
      if (!row.password) continue; // skip Google-only rows or truly empty
      try {
        const stored = (typeof row.password === 'string') ? row.password.trim() : '';
        if (!stored) continue;
        if (process.env.NODE_ENV !== 'production' && stored.length < 50) {
          console.warn(`[login] suspicious stored hash length id=${row.id} len=${stored.length}`);
        }
        const ok = await bcrypt.compare(passNorm, stored);
        if (ok) { authedUser = row; break; }
      } catch (_) { /* ignore */ }
    }

    if (!authedUser) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[login] invalid password for ${emailNorm}. Tried ids:`, result.rows.map(r => r.id));
      }
      // If there are rows but none has a matching password, guide Google users
      const hasGoogleOnly = result.rows.some(r => r.password == null && r.google_id);
      if (hasGoogleOnly && result.rows.every(r => !r.password)) {
        return res.status(400).render("customer/login", { notice: null, error: "❌ This account was created with Google Sign-In. Please use Google to log in or reset your password." });
      }
      return res.status(400).render("customer/login", { notice: null, error: "❌ Invalid password." });
    }

    // 4. Save session
    req.session.user = {
      id: authedUser.id,
      email: authedUser.email,
      role: authedUser.role || "customer", // default role
      first_name: authedUser.first_name || null,
      last_name: authedUser.last_name || null,
      profile_image: authedUser.profile_image || null,
    };

  // set a transient welcome notice for the next page render
  req.session.notice = `Welcome ${authedUser.first_name || (authedUser.email ? authedUser.email.split('@')[0] : 'back')}!`;

    // 4.1 Audit log (best-effort)
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NULL REFERENCES customers(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          meta JSONB NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const meta = { method: 'password', email: authedUser.email, ip: req.ip, ua: req.headers['user-agent'] };
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [authedUser.id, 'auth.login', JSON.stringify(meta)]);
    } catch(_) {}

    // 5. Redirect based on role
    if (authedUser.role === "admin") {
      return res.redirect("/admin");
    } else {
      return res.redirect("/homepage");
    }

  } catch (err) {
    console.error("❌ Database error:", err);
    return res.status(500).render("customer/login", { notice: null, error: "Server error, please try again." });
  }
};


// ✅ Register
export const register = async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword } = req.body;
  const emailNorm = (email || '').trim().toLowerCase();

  // Basic validation
  if (!firstName || !lastName || !emailNorm || !password || !confirmPassword) {
    return res.status(400).send("All fields are required.");
  }

  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match.");
  }

  try {
    // Check if email already exists
    const existingUser = await db.query(
      "SELECT * FROM customers WHERE email = $1",
      [emailNorm]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).send("Email already registered.");
    }

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into customers table
    await db.query(
      "INSERT INTO customers (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)",
      [firstName, lastName, emailNorm, hashedPassword]
    );

    res.redirect("/verify"); // OTP/email verification page
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("Registration failed.");
  }
};
