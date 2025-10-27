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
    const { selectedItems, shipping_amount, discount_code } = req.body || {};
    // Fetch cart items (optionally filtered by selectedItems)
    let cartRows;
    if (selectedItems) {
      const ids = String(selectedItems)
        .split(',')
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
        .map(v => Number(v));
      if (!ids.length) return res.status(400).json({ error: 'Invalid selectedItems' });
      const r = await db.query(
        `SELECT c.quantity,
                CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                     THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                     ELSE p.price
                END AS price,
                p.id AS product_id
         FROM cart c JOIN products p ON c.product_id=p.id
         WHERE c.customer_id=$1 AND c.id = ANY($2::int[])`,
        [customerId, ids]
      );
      cartRows = r.rows;
    } else {
      const r = await db.query(
        `SELECT c.quantity,
                CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                     THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                     ELSE p.price
                END AS price,
                p.id AS product_id
         FROM cart c JOIN products p ON c.product_id=p.id WHERE c.customer_id=$1`,
        [customerId]
      );
      cartRows = r.rows;
    }
    if (!cartRows.length) return res.status(400).json({ error: "Cart empty" });

    // Compute subtotal
    const subtotal = cartRows.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0);

    // Optional discount validation with product scoping
    async function validateDiscount(code) {
      const c = String(code || '').trim().toUpperCase();
      if (!c) return { ok: false, amount: 0 };
      try {
        const q = await db.query('SELECT * FROM discounts WHERE code = $1', [c]);
        if (!q.rows || q.rows.length === 0) return { ok: false, amount: 0 };
        const d = q.rows[0];
        if (d.active === false) return { ok: false, amount: 0 };
        const now = new Date();
        if (d.start_date && new Date(d.start_date) > now) return { ok: false, amount: 0 };
        if (d.end_date && new Date(d.end_date) < now) return { ok: false, amount: 0 };
        const maxUses = (d.max_uses == null) ? null : Number(d.max_uses);
        const used = Number(d.uses || 0);
        if (maxUses !== null && used >= maxUses) return { ok: false, amount: 0 };

        // Determine eligible items based on discount_products mapping
        let eligibleItems = cartRows;
        let isScoped = false;
        try {
          const mapRes = await db.query('SELECT product_id FROM discount_products WHERE discount_id = $1', [d.id]);
          const eligibleIds = (mapRes.rows || []).map(r => Number(r.product_id));
          if (eligibleIds.length > 0) {
            isScoped = true;
            eligibleItems = cartRows.filter(it => eligibleIds.includes(Number(it.product_id)));
          }
        } catch {
          eligibleItems = cartRows;
          isScoped = false;
        }

        if (isScoped && eligibleItems.length === 0) return { ok: false, amount: 0 };

        const eligibleSubtotal = eligibleItems.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0);
        const minOrder = Number(d.min_order || 0);
        if (eligibleSubtotal < minOrder) return { ok: false, amount: 0 };

        const type = String(d.type);
        const value = Number(d.value);
        let amount = 0;
        if (type === 'percent') amount = Math.round((eligibleSubtotal * value / 100) * 100) / 100;
        else amount = Math.round(value * 100) / 100;
        if (amount > eligibleSubtotal) amount = eligibleSubtotal;
        return { ok: true, amount };
      } catch {
        return { ok: false, amount: 0 };
      }
    }

    const disc = await validateDiscount(discount_code);
    const discount = disc.ok ? disc.amount : 0;
    const discountedSubtotal = Math.max(0, subtotal - discount);
    const tax = Math.round(discountedSubtotal * 0.12);
    const shipping = shipping_amount ? Number(shipping_amount) : 0;
    const total = discountedSubtotal + tax + shipping;

  const accessToken = await generateAccessToken();
  const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Create PayPal order
    const orderRes = await axios.post(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: "USD",
            value: total.toFixed(2),
            breakdown: {
              item_total: { currency_code: 'USD', value: discountedSubtotal.toFixed(2) },
              shipping: { currency_code: 'USD', value: shipping.toFixed(2) },
              tax_total: { currency_code: 'USD', value: tax.toFixed(2) },
              ...(discount > 0 ? { discount: { currency_code: 'USD', value: discount.toFixed(2) } } : {})
            }
          }
        }],
        application_context: {
          return_url: `${baseUrl}/api/paypal/capture-order`,
          cancel_url: `${baseUrl}/checkout`
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    const orderID = orderRes.data.id;

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

    // Record paid state in session; final order row is created later in /checkout/place-order
    if (paid) {
      req.session._paypalPaid = req.session._paypalPaid || {};
      req.session._paypalPaid[token] = true;
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
    const paid = !!(req.session._paypalPaid && req.session._paypalPaid[orderID]);
    return res.json({ paid });
  } catch (err) {
    console.error(err);
    return res.json({ paid: false });
  }
});

export default router;
