import pool from "../database/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcrypt";

// transporter for Gmail (use environment variables)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "icaruswearshop@gmail.com",     // 🔴 replace with your Gmail
    pass: "gbddeidjaipndeyo",         // 🔴 replace with App password
  },
});

// Register and send OTP
// Register and send OTP
export const sendOtp = async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

  const otp = crypto.randomInt(100000, 999999).toString();
  // expire OTP after 60 seconds to match client-side timer
  const expires = new Date(Date.now() + 60 * 1000);

    // Store pending registration until OTP verification completes.
    // Create a lightweight table for pending registrations if it doesn't exist.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        id SERIAL PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        otp_code TEXT,
        otp_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Upsert into pending_registrations so repeated attempts update the OTP
    await pool.query(
      `INSERT INTO pending_registrations (first_name, last_name, email, password, otp_code, otp_expires)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           password = EXCLUDED.password,
           otp_code = EXCLUDED.otp_code,
           otp_expires = EXCLUDED.otp_expires,
           created_at = NOW()`,
      [firstName, lastName, email, hashedPassword, otp, expires]
    );

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
subject: "Your Verification Code",
html: `
  <div style="font-family: 'Poppins', Arial, sans-serif; background-color: #f9f9f9; padding: 30px;">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
    <div style="max-width: 500px; background-color: #ffffff; margin: auto; padding: 25px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
      <h2 style="color: #333; text-align: center; font-weight: 600;">Verification Code</h2>
      <p style="font-size: 16px; color: #333;">Dear <strong>${firstName}</strong>,</p>
      <p style="font-size: 15px; color: #555;">
        Please use the following verification code to complete your process:
      </p>
      <div style="text-align: center; margin: 25px 0;">
        <span style="display: inline-block; background-color: #007bff; color: white; padding: 12px 28px; font-size: 20px; font-weight: 600; border-radius: 6px; letter-spacing: 2px;">
          ${otp}
        </span>
      </div>
      <p style="font-size: 14px; color: #666;">Note: This code will expire in <strong>1 minute</strong> for security reasons.</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 25px 0;">
      <p style="font-size: 13px; color: #999; text-align: center;">
        Thank you for verifying your account.<br>
        <strong>[Your Company Name]</strong>
      </p>
    </div>
  </div>
`
    });

    res.render("customer/verify", { email });
  } catch (err) {
    console.error("Error sending OTP:", err);
    res.status(500).send("Error sending OTP");
  }
};



// Verify OTP — finalize pending registration and create customer only after successful verification
export const verifyOtp = async (req, res) => {
  const { otp, email } = req.body;

  try {
    // Lookup pending registration first
    const result = await pool.query(
      "SELECT id, first_name, last_name, password, otp_code, otp_expires FROM pending_registrations WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      // Fallback: maybe legacy row in customers table (older flow)
      const r2 = await pool.query("SELECT otp_code, otp_expires FROM customers WHERE email=$1", [email]);
      if (r2.rows.length === 0) return res.send("No pending registration found for this email");
      const user = r2.rows[0];
      if (user.otp_code !== otp) return res.send("Invalid OTP");
      if (new Date() > user.otp_expires) return res.send("OTP expired");
      // clear legacy OTP and redirect
      await pool.query("UPDATE customers SET otp_code=NULL, otp_expires=NULL WHERE email=$1", [email]);
      return res.redirect("/login");
    }

    const pending = result.rows[0];
    if (pending.otp_code !== otp) return res.send("Invalid OTP");
    if (new Date() > pending.otp_expires) return res.send("OTP expired");

    // Ensure customers table exists (non-destructive guard)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Insert the verified user into customers (upsert to avoid duplicate email errors)
    await pool.query(
      `INSERT INTO customers (first_name, last_name, email, password)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           password = EXCLUDED.password`,
      [pending.first_name, pending.last_name, email, pending.password]
    );

    // Remove the pending registration now that account is created
    await pool.query("DELETE FROM pending_registrations WHERE id=$1", [pending.id]);

    // Redirect to login (or you could auto-login here)
    res.redirect("/login");
  } catch (err) {
    console.error("Error verifying OTP:", err);
    res.status(500).send("Error verifying OTP");
  }
};


// Resend OTP — update pending_registrations first, fallback to customers
export const resendOtp = async (req, res) => {
  const email = req.body?.email || req.query?.email;

  try {
    const otp = String(crypto.randomInt(100000, 999999));
    const expires = new Date(Date.now() + 60 * 1000); // 60 seconds

    // Try updating pending_registrations first
    const up1 = await pool.query(
      "UPDATE pending_registrations SET otp_code=$1, otp_expires=$2 WHERE email=$3 RETURNING first_name, last_name",
      [otp, expires, email]
    );

    let nameForEmail = '';
    if (up1.rowCount > 0) {
      nameForEmail = up1.rows[0].first_name || '';
    } else {
      // Fallback to customers table (legacy)
      const up2 = await pool.query(
        "UPDATE customers SET otp_code=$1, otp_expires=$2 WHERE email=$3 RETURNING first_name, last_name",
        [otp, expires, email]
      );
      if (up2.rowCount > 0) nameForEmail = up2.rows[0].first_name || '';
      else return res.send("User not found");
    }

    const mailHtml = `
  <div style="font-family: 'Poppins', Arial, sans-serif; background-color: #f9f9f9; padding: 30px;">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
    <div style="max-width: 500px; background-color: #ffffff; margin: auto; padding: 25px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
      <h2 style="color: #333; text-align: center; font-weight: 600;">Resent Verification Code</h2>
      <p style="font-size: 16px; color: #333;">${nameForEmail ? `<strong>${nameForEmail}</strong>,` : 'Hello,'}</p>
      <p style="font-size: 15px; color: #555;">
        You requested a new verification code. Please use the code below to complete your verification:
      </p>
      <div style="text-align: center; margin: 25px 0;">
        <span style="display: inline-block; background-color: #007bff; color: white; padding: 12px 28px; font-size: 20px; font-weight: 600; border-radius: 6px; letter-spacing: 2px;">
          ${otp}
        </span>
      </div>
      <p style="font-size: 14px; color: #666;">Note: This code will expire in <strong>1 minute</strong> for security purposes.</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 25px 0;">
      <p style="font-size: 13px; color: #999; text-align: center;">
        Thank you for verifying your account.<br>
        <strong>[Your Company Name]</strong>
      </p>
    </div>
  </div>
`;

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Your OTP code',
      html: mailHtml,
    });

    // If this was requested via AJAX, return JSON so the client can reset timer without full page reload
    if (req.query?.ajax || req.xhr) {
      return res.json({ success: true, message: 'OTP resent' });
    }

    // Otherwise render the verify page (normal flow)
    res.render('customer/verify', { email });
  } catch (err) {
    console.error('Error resending OTP:', err);
    res.status(500).send('Error resending OTP');
  }
};
