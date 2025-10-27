import pool from "../database/db.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcrypt";

// transporter for Gmail (use environment variables)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ambongvincent@gmail.com",     // 🔴 replace with your Gmail
    pass: "ueszvkrmivdliive",         // 🔴 replace with App password
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

    await pool.query(
      `INSERT INTO customers (first_name, last_name, email, password, otp_code, otp_expires)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE 
       SET first_name=$1, last_name=$2, password=$4, otp_code=$5, otp_expires=$6`,
      [firstName, lastName, email, hashedPassword, otp, expires]
    );

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      text: `Hello ${firstName}, your verification code is ${otp}. It expires in 1 minute.`,
    });

    res.render("customer/verify", { email });
  } catch (err) {
    console.error("Error sending OTP:", err);
    res.status(500).send("Error sending OTP");
  }
};



// Verify OTP
export const verifyOtp = async (req, res) => {
  const { otp, email } = req.body;

  try {
    const result = await pool.query(
      "SELECT otp_code, otp_expires FROM customers WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) return res.send("User not found");

    const user = result.rows[0];
    if (user.otp_code !== otp) return res.send("Invalid OTP");
    if (new Date() > user.otp_expires) return res.send("OTP expired");

    // clear OTP after verification
    await pool.query(
      "UPDATE customers SET otp_code=NULL, otp_expires=NULL WHERE email=$1",
      [email]
    );

    res.redirect("/login");
  } catch (err) {
    console.error("Error verifying OTP:", err);
    res.status(500).send("Error verifying OTP");
  }
};


// Resend OTP
export const resendOtp = async (req, res) => {
  const { email } = req.query;

  try {
  const otp = crypto.randomInt(100000, 999999).toString();
  // expire OTP after 60 seconds to match client-side timer
  const expires = new Date(Date.now() + 60 * 1000);

    await pool.query(
      "UPDATE customers SET otp_code=$1, otp_expires=$2 WHERE email=$3",
      [otp, expires, email]
    );

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Resent OTP Code",
      text: `Your new OTP code is ${otp}. It will expire in 1 minute.`,
    });

    // If this was requested via AJAX, return JSON so the client can reset timer without full page reload
    if (req.query.ajax || req.xhr) {
      return res.json({ success: true, message: 'OTP resent' });
    }

    // Otherwise render the verify page (normal flow)
    res.render("customer/verify", { email });
  } catch (err) {
    console.error("Error resending OTP:", err);
    res.status(500).send("Error resending OTP");
  }
};
