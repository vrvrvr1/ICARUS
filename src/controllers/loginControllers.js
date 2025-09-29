import bcrypt from "bcrypt";
import db from "../database/db.js";

export const login = async (req, res) => {
  const { email, password } = req.body;

  // 1. Basic validation
  if (!email || !password) {
    return res.status(400).send("⚠️ Please enter both email and password.");
  }

  try {
    // 2. Find user by email
    const result = await db.query(
      "SELECT * FROM customers WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("❌ User not found.");
    }

    const user = result.rows[0];

    // 3. Compare bcrypt hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send("❌ Invalid password.");
    }

    // 4. Save session
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role || "customer", // default role
    };

    // 5. Redirect based on role
    if (user.role === "admin") {
      return res.redirect("/admin");
    } else {
      return res.redirect("/homepage");
    }

  } catch (err) {
    console.error("❌ Database error:", err);
    return res.status(500).send("Server error, please try again.");
  }
};


// ✅ Register
export const register = async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword } = req.body;

  // Basic validation
  if (!firstName || !lastName || !email || !password || !confirmPassword) {
    return res.status(400).send("All fields are required.");
  }

  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match.");
  }

  try {
    // Check if email already exists
    const existingUser = await db.query(
      "SELECT * FROM customers WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).send("Email already registered.");
    }

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into customers table
    await db.query(
      "INSERT INTO customers (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)",
      [firstName, lastName, email, hashedPassword]
    );

    res.redirect("/verify"); // OTP/email verification page
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("Registration failed.");
  }
};
