// src/Routes/paypalRoutes.js
import express from "express";
import axios from "axios";
import db from "../database/db.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

// Generate PayPal Access Token
async function generateAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const res = await axios.post(
    `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
    "grant_type=client_credentials",
    { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data.access_token;
}

// Create PayPal Order (pending only)
router.post("/create-order", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });

  const customerId = req.session.user.id;

  try {
    // Get cart total
    const cartResult = await db.query(
      `SELECT c.quantity, p.price FROM cart c JOIN products p ON c.product_id=p.id WHERE c.customer_id=$1`,
      [customerId]
    );
    if (!cartResult.rows.length) return res.status(400).json({ error: "Cart empty" });

    let subtotal = 0;
    cartResult.rows.forEach(item => subtotal += item.price * item.quantity);
    const tax = Math.round(subtotal * 0.12);
    const total = subtotal + tax;

    const accessToken = await generateAccessToken();

    // Create PayPal order
    const orderRes = await axios.post(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: total.toFixed(2) } }],
        application_context: {
          return_url: `http://localhost:3000/api/paypal/capture-order`,
          cancel_url: `http://localhost:3000/checkout`
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    const orderID = orderRes.data.id;

    // Insert order as pending in DB (do not mark completed)
    await db.query(
      `INSERT INTO orders (customer_id, paypal_order_id, payment_method, status, payment_completed, subtotal, tax, total)
       VALUES ($1,$2,$3,'pending',false,$4,$5,$6)`,
      [customerId, orderID, "PayPal", subtotal, tax, total]
    );

    // Return PayPal approval link to frontend
    const approveUrl = orderRes.data.links.find(link => link.rel === "approve").href;
    res.json({ approveUrl, orderID });

  } catch (err) {
    console.error("PayPal create-order error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create PayPal order" });
  }
});

// Capture PayPal Order
router.get("/capture-order", async (req, res) => {
  const { token } = req.query; // PayPal order ID
  if (!token) return res.status(400).send("<script>alert('Invalid PayPal token');window.close();</script>");

  try {
    const accessToken = await generateAccessToken();

    const captureRes = await axios.post(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${token}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const paid = captureRes.data.status === "COMPLETED";

    if (paid) {
      // Mark order as completed in DB
      const orderResult = await db.query(
        `UPDATE orders SET status='completed', payment_completed=true
         WHERE paypal_order_id=$1 RETURNING customer_id`,
        [token]
      );


    }

    res.send("<script>window.close();</script>");
  } catch (err) {
    console.error("PayPal capture-order error:", err.response?.data || err.message);
    res.send("<script>alert('Payment failed');window.close();</script>");
  }
});

// Check payment status
router.get("/check-status", async (req, res) => {
  const { orderID } = req.query;
  if (!orderID) return res.json({ paid: false });

  try {
    const result = await db.query(`SELECT payment_completed FROM orders WHERE paypal_order_id=$1`, [orderID]);
    res.json({ paid: result.rows[0]?.payment_completed || false });
  } catch (err) {
    console.error(err);
    res.json({ paid: false });
  }
});

export default router;
