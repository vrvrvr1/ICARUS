// src/Routes/orderRoutes.js
import express from "express";
import db from "../database/db.js";
import storeConfig from "../utils/storeConfig.js";

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

// GET /orders/:orderId — lightweight order details (redirects to receipt for now)
router.get("/orders/:orderId", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  try {
    const orderRes = await db.query(
      `SELECT *, COALESCE(order_date, created_at) AS created_on
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    if (!orderRes.rows.length) return res.status(404).send("Order not found");

    // For now, redirect to the receipt page you already have
    return res.redirect(`/checkout/confirmation/${orderId}`);
  } catch (err) {
    console.error("Order details error:", err);
    return res.status(500).send("Server error");
  }
});

// GET /orders/:orderId/track — tracking page with status timeline and map
router.get("/orders/:orderId/track", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  try {
    const orderRes = await db.query(
      `SELECT id, status, payment_method, payment_completed,
              estimated_delivery,
              estimated_delivery_start,
              estimated_delivery_end,
              COALESCE(order_date, created_at) AS created_on
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    if (!orderRes.rows.length) return res.status(404).send("Order not found");
    const order = orderRes.rows[0];

    // Optionally load per-status timestamps if the columns exist in the DB
    let statusTimes = {};
    try {
      const colsRes = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = ANY($1)`,
        [["paid_at", "shipped_at", "out_for_delivery_at", "delivered_at"]]
      );
      const cols = new Set((colsRes.rows || []).map(r => r.column_name));
      const wanted = Array.from(cols);
      if (wanted.length) {
        const selectList = wanted.map(c => `${c}`).join(", ");
        const tsRes = await db.query(`SELECT ${selectList} FROM orders WHERE id = $1`, [orderId]);
        statusTimes = tsRes.rows[0] || {};
      }
    } catch (e) {
      // If schema check fails or columns missing, proceed without timestamps
      statusTimes = {};
    }

    // Derive step states from status/payment
    const statusText = (order.status || '').toLowerCase();
    const paid = !!order.payment_completed || order.payment_method === 'COD';
    const shipped = /ship|out/.test(statusText);
    const delivered = /deliver|complete/.test(statusText);

    const steps = [
      { key: 'placed', label: 'Order placed', done: true },
      { key: 'paid', label: paid ? 'Payment confirmed' : 'Awaiting payment', done: paid },
      { key: 'shipped', label: 'Shipped', done: shipped || delivered },
      { key: 'delivered', label: 'Delivered', done: delivered },
    ];

    // Fetch order items for summary
    const itemsRes = await db.query(`
      SELECT oi.order_id,
             COALESCE(oi.product_name, p.name) AS product_name,
             COALESCE(oi.image_url, p.image_url) AS image_url,
             oi.quantity,
             oi.price
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `, [orderId]);

    const items = itemsRes.rows.map(r => ({
      product_name: r.product_name,
      image_url: r.image_url,
      quantity: Number(r.quantity || 0),
      price: Number(r.price || 0)
    }));

    const total = items.reduce((sum, it) => sum + it.quantity * it.price, 0);

  res.render("customer/order-track", { user: req.session.user, order, steps, store: storeConfig, items, total, statusTimes });
  } catch (err) {
    console.error("Order track error:", err);
    return res.status(500).send("Server error");
  }
});

export default router;
