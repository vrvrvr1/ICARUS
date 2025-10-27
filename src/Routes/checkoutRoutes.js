// src/Routes/checkoutRoutes.js
import express from "express";
import db from "../database/db.js";

const router = express.Router();

// --------------------------
// Middleware: Authentication
// --------------------------
function isAuthenticated(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// --------------------------
// Helper Functions
// --------------------------
async function getCartItems(customerId) {
  const result = await db.query(
    `SELECT c.id, c.quantity, c.color, c.size,
            p.id AS product_id,
            p.name AS product_name,
            -- effective unit price with per-product promo if enabled
            CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                 THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                 ELSE p.price
            END AS price,
            p.price AS original_price,
            COALESCE(p.promo_active, false) AS promo_active,
            COALESCE(p.promo_percent, 0) AS promo_percent,
            p.image_url
     FROM cart c
     JOIN products p ON c.product_id = p.id
     WHERE c.customer_id=$1
     ORDER BY c.id DESC`,
    [customerId]
  );
  return result.rows;
}

function calculateCartTotal(cartItems, shippingAmount = 0, discountAmount = 0) {
  let subtotal = 0;
  cartItems.forEach(item => subtotal += item.price * item.quantity);
  // shippingAmount is provided by caller or defaults; per-product free shipping is not handled here
  const discount = Math.min(Math.max(Number(discountAmount || 0), 0), subtotal);
  const discountedSubtotal = subtotal - discount;
  const tax = Math.round(discountedSubtotal * 0.12);
  const total = discountedSubtotal + tax + Number(shippingAmount || 0);
  return { subtotal, discount, tax, shipping: Number(shippingAmount || 0), total };
}

// Validate a discount code against rules and compute amount
async function validateDiscountCode(codeRaw, cartItems) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'EMPTY' };
  // compute current cart subtotal (entire cart)
  const cartSubtotal = cartItems.reduce((sum, it) => sum + (Number(it.price) * Number(it.quantity)), 0);
  try {
    const q = await db.query('SELECT * FROM discounts WHERE code = $1', [code]);
    if (!q.rows || q.rows.length === 0) return { ok: false, reason: 'NOT_FOUND' };
    const d = q.rows[0];
    if (d.active === false) return { ok: false, reason: 'INACTIVE' };
    const now = new Date();
    if (d.start_date && new Date(d.start_date) > now) return { ok: false, reason: 'NOT_STARTED' };
    if (d.end_date && new Date(d.end_date) < now) return { ok: false, reason: 'EXPIRED' };
    const maxUses = (d.max_uses == null) ? null : Number(d.max_uses);
    const used = Number(d.uses || 0);
    if (maxUses !== null && used >= maxUses) return { ok: false, reason: 'MAX_USES' };

    // Determine eligible items for this discount based on discount_products mapping.
    // If no mappings exist, treat as "applies to all products".
    let eligibleItems = cartItems;
    let isScoped = false;
    try {
      const mapRes = await db.query('SELECT product_id FROM discount_products WHERE discount_id = $1', [d.id]);
      const eligibleIds = (mapRes.rows || []).map(r => Number(r.product_id));
      if (eligibleIds.length > 0) {
        isScoped = true;
        eligibleItems = cartItems.filter(it => eligibleIds.includes(Number(it.product_id)));
      }
    } catch (emap) {
      // If mapping query fails, fall back to applying to all items (safe default) but log.
      console.warn('discount_products mapping lookup failed:', emap.message);
      eligibleItems = cartItems;
      isScoped = false;
    }

    // If the discount is scoped to specific products but none are in the cart, it's ineligible
    if (isScoped && eligibleItems.length === 0) {
      return { ok: false, reason: 'NO_ELIGIBLE_ITEMS' };
    }

    const eligibleSubtotal = eligibleItems.reduce((sum, it) => sum + (Number(it.price) * Number(it.quantity)), 0);

    // Enforce min_order against eligibleSubtotal (not the entire cart)
    const minOrder = Number(d.min_order || 0);
    if (eligibleSubtotal < minOrder) return { ok: false, reason: 'MIN_ORDER', min_order: minOrder };

    const type = String(d.type);
    const value = Number(d.value);
    let amount = 0;
    if (type === 'percent') {
      amount = Math.round((eligibleSubtotal * value / 100) * 100) / 100; // 2-decimal rounding
    } else { // fixed
      amount = Math.round(value * 100) / 100;
    }
    if (amount > eligibleSubtotal) amount = eligibleSubtotal;
    return { ok: true, code, type, value, amount, subtotal: cartSubtotal, discount_id: d.id };
  } catch (e) {
    console.warn('validateDiscountCode error:', e.message);
    return { ok: false, reason: 'ERROR' };
  }
}

// --------------------------
// GET /checkout — show checkout page
// --------------------------
// GET /checkout — show checkout page
router.get("/", isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;
    // If items query param provided (comma-separated cart row ids), only fetch those
    const itemsParam = req.query.items;
    let cartItems;
    if (itemsParam) {
      const ids = itemsParam.split(',').map(v => Number(v.trim())).filter(Boolean);
      if (ids.length === 0) {
        cartItems = await getCartItems(customer_id);
      } else {
        const result = await db.query(
          `SELECT c.id, c.quantity, c.color, c.size, p.id AS product_id, p.name AS product_name,
                  CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                       THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                       ELSE p.price
                  END AS price,
                  p.price AS original_price,
                  COALESCE(p.promo_active, false) AS promo_active,
                  COALESCE(p.promo_percent, 0) AS promo_percent,
                  p.image_url
           FROM cart c JOIN products p ON c.product_id = p.id
           WHERE c.customer_id=$1 AND c.id = ANY($2::int[])
           ORDER BY c.id DESC`,
          [customer_id, ids]
        );
        cartItems = result.rows;
      }
    } else {
      // Fetch all cart items
  cartItems = await getCartItems(customer_id);
    }
  // determine shipping from query param (if provided) or default to standard
  const shippingParam = req.query.shipping;
  const shippingAmount = shippingParam ? parseFloat(shippingParam) || 0 : 4.99;
  const { subtotal, tax, shipping, total } = calculateCartTotal(cartItems, shippingAmount);

    // Fetch user info from DB
    const userResult = await db.query(
      `SELECT first_name, last_name, email FROM customers WHERE id=$1`,
      [customer_id]
    );

    const user = userResult.rows[0]; // This will have first_name, last_name, etc.

    res.render("customer/checkout", {
      user,      // user info from DB
      cartItems,
      subtotal,
      tax,
      shipping,
      total,
      selectedItems: itemsParam || null
    });
  } catch (err) {
    console.error("Checkout GET error:", err);
    res.status(500).send("Error loading checkout page");
  }
});


// --------------------------
// POST /checkout/place-order — final order submission
// --------------------------
router.post("/place-order", isAuthenticated, async (req, res) => {
  const customer_id = req.session.user.id;
  const { firstName, lastName, address, city, province, zip, phone, email, payment_method, idempotency_key, paypal_order_id, discount_code } = req.body;

  try {
    console.log('Place-order POST body:', req.body);

    // Idempotency guard: prevent duplicate processing for the same key within session
    if (idempotency_key) {
      req.session._lastOrderKeys = req.session._lastOrderKeys || {};
      req.session._inflightOrderKeys = req.session._inflightOrderKeys || {};
      if (req.session._lastOrderKeys[idempotency_key]) {
        return res.json({ success: true, orderId: req.session._lastOrderKeys[idempotency_key] });
      }
      if (req.session._inflightOrderKeys[idempotency_key]) {
        return res.json({ success: false, error: 'Order is already being processed' });
      }
      // mark as inflight
      req.session._inflightOrderKeys[idempotency_key] = true;
    }
    // If body contains selectedItems (comma-separated cart ids), honor that selection
  let cartItems;
    if (req.body.selectedItems) {
      // stricter parse: allow only integers
      const ids = String(req.body.selectedItems)
        .split(',')
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
        .map(v => Number(v));

      console.log('Place-order received selectedItems:', req.body.selectedItems, '=> parsed ids:', ids);

      if (ids.length > 0) {
        const result = await db.query(
          `SELECT c.id, c.quantity, c.color, c.size, p.id AS product_id, p.name AS product_name,
                  CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                       THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                       ELSE p.price
                  END AS price,
                  p.price AS original_price,
                  COALESCE(p.promo_active, false) AS promo_active,
                  COALESCE(p.promo_percent, 0) AS promo_percent,
                  p.image_url
           FROM cart c JOIN products p ON c.product_id = p.id
           WHERE c.customer_id=$1 AND c.id = ANY($2::int[])
           ORDER BY c.id DESC`,
          [customer_id, ids]
        );
        cartItems = result.rows;
      } else {
        // If selectedItems was provided but parsing produced no valid ids, reject the request
        return res.json({ success: false, error: 'Invalid selectedItems provided' });
      }
    } else {
      cartItems = await getCartItems(customer_id);
    }

    console.log('Cart items selected for order:', cartItems.map(i => i.id));

    if (cartItems.length === 0) {
      return res.json({ success: false, error: "Cart is empty" });
    }

  // parse shipping selection from the POST body (if provided)
  const shippingFromBody = req.body.shipping_amount ? parseFloat(req.body.shipping_amount) : 0;

    // Optional: Validate discount code against current cart
    let discountApply = { ok: false, amount: 0 };
    if (discount_code) {
      discountApply = await validateDiscountCode(discount_code, cartItems);
      if (!discountApply.ok) {
        // If invalid at placement, reject with a clear message
        return res.json({ success: false, error: 'Invalid or ineligible discount code' });
      }
    }

    const { subtotal, discount, tax, shipping: shippingAmt, total } = calculateCartTotal(cartItems, shippingFromBody, discountApply.amount);

    // Insert order and decrement stock in a single transaction
  let orderId;
  // Track touched product ids for optional post-commit stock sync
  let touchedProductIds = new Set();
    // Detect if order_items table supports color/size columns to avoid failing inside a transaction
    let orderItemsHasColor = false;
    let orderItemsHasSize = false;
    try {
      const colRes = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = ANY($1)` ,
        [[ 'color', 'size' ]]
      );
      const cols = new Set((colRes.rows || []).map(r => r.column_name));
      orderItemsHasColor = cols.has('color');
      orderItemsHasSize = cols.has('size');
    } catch(_) {}
    const client = await db.connect();
    if (payment_method === 'PayPal') {
      if (!paypal_order_id) {
        return res.json({ success: false, error: 'paypal_order_id missing for PayPal payment' });
      }
      const paid = !!(req.session._paypalPaid && req.session._paypalPaid[paypal_order_id]);
      if (!paid) {
        return res.json({ success: false, error: 'PayPal payment not confirmed yet' });
      }
    }

    try {
      await client.query('BEGIN');
      if (payment_method === 'PayPal' && paypal_order_id) {
        const insertRes = await client.query(
          `INSERT INTO orders
            (customer_id, paypal_order_id, first_name, last_name, address, city, province, zipcode, phone, email, payment_method, subtotal, tax, total, status, payment_completed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Processing',true)
           RETURNING id`,
          [customer_id, paypal_order_id, firstName, lastName, address, city, province, zip, phone, email, payment_method, subtotal, tax, total]
        );
        orderId = insertRes.rows[0].id;
      } else {
        const initialStatus = 'Processing';
        const orderResult = await client.query(
          `INSERT INTO orders
            (customer_id, first_name, last_name, address, city, province, zipcode, phone, email, payment_method, subtotal, tax, total, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [customer_id, firstName, lastName, address, city, province, zip, phone, email, payment_method, subtotal, tax, total, initialStatus]
        );
        orderId = orderResult.rows[0].id;
      }

  // Decrement per-size/product stock atomically per cart item
      for (const item of cartItems) {
        const pid = Number(item.product_id);
        const qty = Math.max(1, Number(item.quantity || 1));
        const size = item.size ? String(item.size).toUpperCase() : null;
        const colorLC = item.color ? String(item.color).toLowerCase() : null;
        if (pid) touchedProductIds.add(pid);
        if (pid && size && colorLC) {
          const dec = await client.query(
            `UPDATE product_variants SET stock = stock - $4
             WHERE product_id = $1 AND UPPER(size) = UPPER($2) AND LOWER(color) = LOWER($3) AND stock >= $4
             RETURNING 1`,
            [pid, size, colorLC, qty]
          );
          if (dec.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `Insufficient stock for ${colorLC}/${size}`, product_id: pid, size, color: colorLC });
          }
        } else if (pid) {
          // No size provided. Try to auto-pick:
          // 1) If exactly one size has sufficient stock for this qty, choose it.
          // 2) Else if only one size exists at all, choose it.
          // 3) Else, prefer ONE/OS-like defaults if available and sufficient.
          const pref = ['ONE','ONESIZE','OS','FREE','UNIV'];
          const vres = await client.query(
            `SELECT LOWER(color) AS color, UPPER(size) AS size, stock FROM product_variants WHERE product_id = $1`,
            [pid]
          );
          const rows = (vres.rows || []).map(r => ({ color: String(r.color).toLowerCase(), size: String(r.size).toUpperCase(), stock: Number(r.stock || 0) }));
          let chosen = null; // {color,size}
          // If color provided but not size
          if (colorLC && !size) {
            const cand = rows.filter(r => r.color === String(colorLC).toLowerCase());
            const sufficient = cand.filter(r => r.stock >= qty);
            if (sufficient.length === 1) chosen = { color: sufficient[0].color, size: sufficient[0].size };
            else if (cand.length === 1) chosen = { color: cand[0].color, size: cand[0].size };
          }
          // If size provided but not color
          if (!colorLC && size) {
            const cand = rows.filter(r => r.size === String(size).toUpperCase());
            const sufficient = cand.filter(r => r.stock >= qty);
            if (sufficient.length === 1) chosen = { color: sufficient[0].color, size: sufficient[0].size };
            else if (cand.length === 1) chosen = { color: cand[0].color, size: cand[0].size };
          }
          // If neither provided
          if (!colorLC && !size && !chosen) {
            const sufficient = rows.filter(r => r.stock >= qty);
            if (sufficient.length === 1) chosen = { color: sufficient[0].color, size: sufficient[0].size };
            else if (rows.length === 1) chosen = { color: rows[0].color, size: rows[0].size };
            else {
              // prefer ONE/OS-like sizes among sufficient
              const set = new Set(sufficient.map(r => r.size));
              for (const key of pref) { if (set.has(key)) { const v = sufficient.find(r=>r.size===key); if (v) { chosen = { color: v.color, size: v.size }; break; } } }
            }
          }
          if (!chosen) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: 'Size is required for this product', product_id: pid });
          }
          const dec = await client.query(
            `UPDATE product_variants SET stock = stock - $4
             WHERE product_id = $1 AND UPPER(size) = UPPER($2) AND LOWER(color) = LOWER($3) AND stock >= $4
             RETURNING 1`,
            [pid, chosen.size, chosen.color, qty]
          );
          if (dec.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: false, error: `Insufficient stock for ${chosen.color}/${chosen.size}`, product_id: pid, size: chosen.size, color: chosen.color });
          }
          // Also set size for this order item insertion path
          item.size = chosen.size;
          item.color = chosen.color;
        }
      }

      // Insert order items (compose SQL based on available columns to avoid errors inside transaction)
      for (const item of cartItems) {
        const pid = Number(item.product_id) || null;
        if (orderItemsHasColor && orderItemsHasSize) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, image_url, color, size)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [orderId, pid, item.product_name, item.quantity, item.price, item.image_url, item.color || null, item.size || null]
          );
        } else {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, image_url)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [orderId, pid, item.product_name, item.quantity, item.price, item.image_url]
          );
        }
      }

      // Clear cart entries that were ordered
      if (req.body.selectedItems) {
        const ids = String(req.body.selectedItems)
          .split(',')
          .map(v => v.trim())
          .filter(v => /^\d+$/.test(v))
          .map(v => Number(v));
        if (ids.length > 0) {
          await client.query('DELETE FROM cart WHERE customer_id=$1 AND id = ANY($2::int[])', [customer_id, ids]);
        }
      } else {
        await client.query('DELETE FROM cart WHERE customer_id=$1', [customer_id]);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch(_) {}
      console.error('Order transaction error:', txErr);
      if (idempotency_key && req.session && req.session._inflightOrderKeys) {
        delete req.session._inflightOrderKeys[idempotency_key];
      }
      return res.json({ success: false, error: 'Failed to place order' });
    } finally {
      client.release();
    }

    // Best-effort: sync total product stock from product_variants after COMMIT (avoid affecting the transaction)
    if (touchedProductIds && touchedProductIds.size > 0) {
      try {
        const hasCol = await db.query(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock'
           ) AS has_stock`
        );
        if (hasCol.rows?.[0]?.has_stock) {
          const idsArr = Array.from(touchedProductIds);
          await db.query(
            `UPDATE products p
               SET stock = x.total
             FROM (
               SELECT product_id, COALESCE(SUM(stock),0) AS total
               FROM product_variants
               WHERE product_id = ANY($1::int[])
               GROUP BY product_id
             ) x
             WHERE p.id = x.product_id`,
            [idsArr]
          );
        }
      } catch (e) {
        // Non-fatal: if products.stock doesn't exist or any error occurs, skip without affecting order success
        console.warn('Stock sync skipped (post-commit):', e.message);
      }
    }

    // If a discount was applied, increment its usage count
    try {
      if (discountApply.ok && discountApply.discount_id) {
        await db.query('UPDATE discounts SET uses = uses + 1 WHERE id = $1', [discountApply.discount_id]);
      }
    } catch (e) {
      // non-fatal
      console.warn('Failed to increment discount uses:', e.message);
    }

    // Record the idempotency key mapping for this session
    if (idempotency_key) {
      req.session._lastOrderKeys[idempotency_key] = orderId;
      delete req.session._inflightOrderKeys[idempotency_key];
    }

    // Create a user notification for the successful order placement (best-effort)
    try {
      // Ensure notifications table exists (idempotent)
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
      const notifTitle = 'Order placed successfully';
      const notifBody = `Your order #${orderId} was placed successfully.`;
      const notifLink = `/checkout/confirmation/${orderId}`;
      await db.query(
        `INSERT INTO user_notifications (user_id, title, body, link)
         VALUES ($1, $2, $3, $4)`,
        [customer_id, notifTitle, notifBody, notifLink]
      );
    } catch (e) {
      // Non-fatal: if notifications table doesn't exist and cannot be created or insert fails, just log
      console.warn('Order notification insert skipped:', e.message);
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error("Place order error:", err);
    if (idempotency_key && req.session && req.session._inflightOrderKeys) {
      delete req.session._inflightOrderKeys[idempotency_key];
    }
    res.json({ success: false, error: "Server error while placing order" });
  }
});

// --------------------------
// POST /checkout/apply-discount — validate and preview totals
// --------------------------
router.post('/apply-discount', isAuthenticated, async (req, res) => {
  const customer_id = req.session.user.id;
  const { code, selectedItems, shipping_amount } = req.body || {};
  try {
    // Fetch appropriate cart items
    let cartItems;
    if (selectedItems) {
      const ids = String(selectedItems)
        .split(',')
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
        .map(v => Number(v));
      if (ids.length > 0) {
        const result = await db.query(
          `SELECT c.id, c.quantity, c.color, c.size, p.id AS product_id, p.name AS product_name,
                  CASE WHEN COALESCE(p.promo_active, false) = true AND COALESCE(p.promo_percent, 0) > 0
                       THEN ROUND(p.price * (1 - (p.promo_percent/100.0))::numeric, 2)
                       ELSE p.price
                  END AS price,
                  p.price AS original_price,
                  COALESCE(p.promo_active, false) AS promo_active,
                  COALESCE(p.promo_percent, 0) AS promo_percent,
                  p.image_url
           FROM cart c JOIN products p ON c.product_id = p.id
           WHERE c.customer_id=$1 AND c.id = ANY($2::int[])
           ORDER BY c.id DESC`,
          [customer_id, ids]
        );
        cartItems = result.rows;
      } else {
        return res.json({ ok: false, error: 'Invalid selectedItems' });
      }
    } else {
      cartItems = await getCartItems(customer_id);
    }

    if (!cartItems || cartItems.length === 0) return res.json({ ok: false, error: 'Cart is empty' });

    const shipping = shipping_amount ? parseFloat(shipping_amount) : 0;
    const validation = await validateDiscountCode(code, cartItems);
    if (!validation.ok) {
      return res.json({ ok: false, reason: validation.reason, min_order: validation.min_order || null });
    }
    const totals = calculateCartTotal(cartItems, shipping, validation.amount);
    return res.json({
      ok: true,
      discount: {
        code: validation.code,
        type: validation.type,
        value: validation.value,
        amount: totals.discount
      },
      summary: {
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        shipping: totals.shipping,
        total: totals.total
      }
    });
  } catch (e) {
    console.error('apply-discount error:', e);
    res.json({ ok: false, error: 'Server error' });
  }
});

// --------------------------
// GET /checkout/confirmation/:orderId — order confirmation page
// --------------------------
router.get("/confirmation/:orderId", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customer_id = req.session.user.id;

  try {
    const orderResult = await db.query(
      `SELECT * FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customer_id]
    );

    if (orderResult.rows.length === 0) return res.redirect("/checkout");

    const order = orderResult.rows[0];

    const itemsResult = await db.query(
      `SELECT * FROM order_items WHERE order_id=$1`,
      [orderId]
    );

    res.render("customer/orderconfirmation", {
      user: req.session.user,
      order,
      items: itemsResult.rows
    });
  } catch (err) {
    console.error("Order confirmation error:", err);
    res.status(500).send("Error loading order confirmation");
  }
});

export default router;
