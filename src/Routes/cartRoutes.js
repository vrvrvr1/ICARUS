import express from "express";
import db from "../database/db.js";
import { requireActiveUser } from "../Middleware/authMiddleware.js";
const router = express.Router();

// ✅ View cart
router.get("/", requireActiveUser, async (req, res) => {
  const customer_id = req.session.user.id;
  try {
    const cartItems = await db.query(
      `SELECT c.id, c.quantity, c.color, c.size,
              p.id AS product_id,
              p.name AS product_name,
              -- effective price considers per-product promo if active
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
       WHERE c.customer_id = $1
       ORDER BY c.id DESC`,   
      [customer_id]
    );

  res.render("customer/cart", { cartItems: cartItems.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading cart");
  }
});

// ✅ Add to cart
// ✅ Add to cart
router.post("/add", requireActiveUser, async (req, res) => {
  console.log("BODY RECEIVED:", req.body);

  // Prevent banned users from adding to cart
  try {
    if (req.session && req.session.user && req.session.user.is_banned) {
      return res.status(403).json({ error: 'account_banned', message: 'Your account is banned.' });
    }
  } catch(_) {}

  let { product_id, color, size, quantity } = req.body;

  product_id = parseInt(product_id);
  quantity = parseInt(quantity) || 1;
  const customer_id = req.session.user.id;

  if (!product_id) {
    return res.status(400).send("Please select a product");
  }

  try {
// Try to infer missing color/size from product_variants
try {
  const q = await db.query(`SELECT LOWER(color) AS color, UPPER(size) AS size, stock FROM product_variants WHERE product_id = $1`, [product_id]);
  const rows = (q.rows || []).map(r => ({ color: String(r.color).toLowerCase(), size: String(r.size).toUpperCase(), stock: Number(r.stock || 0) }));
  // If size missing but color provided
  if (!size && color) {
    const cand = rows.filter(r => r.color === String(color).toLowerCase());
    const sufficient = cand.filter(r => r.stock >= quantity);
    if (sufficient.length === 1) size = sufficient[0].size;
    else if (cand.length === 1) size = cand[0].size;
    else if (cand.length > 1 && !size) return res.status(400).json({ error: 'Size is required for this color' });
  }
  // If color missing but size provided
  if (!color && size) {
    const cand = rows.filter(r => r.size === String(size).toUpperCase());
    const sufficient = cand.filter(r => r.stock >= quantity);
    if (sufficient.length === 1) color = sufficient[0].color;
    else if (cand.length === 1) color = cand[0].color;
    else if (cand.length > 1 && !color) return res.status(400).json({ error: 'Color is required for this size' });
  }
  // If both missing
  if (!color && !size) {
    const sufficient = rows.filter(r => r.stock >= quantity);
    if (sufficient.length === 1) { color = sufficient[0].color; size = sufficient[0].size; }
    else if (rows.length === 1) { color = rows[0].color; size = rows[0].size; }
  }
} catch(_) {}
// Validate stock for selected variant if exists
let maxStock = null;
try {
  if (size && color) {
    const ss = await db.query(
      `SELECT stock FROM product_variants WHERE product_id = $1 AND UPPER(size) = UPPER($2) AND LOWER(color) = LOWER($3)`,
      [product_id, size, color]
    );
    if (ss.rows.length) maxStock = Number(ss.rows[0].stock || 0);
  }
} catch (_) { /* ignore if table missing */ }

// If no variant record, fallback to total variant stock sum
if (maxStock === null) {
  try {
    const ps = await db.query(`SELECT COALESCE(SUM(stock),0) AS total FROM product_variants WHERE product_id = $1`, [product_id]);
    if (ps.rows.length) maxStock = Number(ps.rows[0].total || 0);
  } catch(_) {}
}

// Consider existing quantity in cart for same variant
let existingQty = 0;
try {
  const ex = await db.query(
    `SELECT quantity FROM cart WHERE customer_id=$1 AND product_id=$2 AND color = $3 AND size = $4`,
    [customer_id, product_id, color, size]
  );
  if (ex.rows.length) existingQty = Number(ex.rows[0].quantity || 0);
} catch(_) {}

if (maxStock !== null && maxStock >= 0) {
  if (existingQty + quantity > maxStock) {
    return res.status(409).json({ error: "Not enough stock for selected size", available: Math.max(0, maxStock - existingQty) });
  }
}

const existing = await db.query(
  "SELECT * FROM cart WHERE customer_id = $1 AND product_id = $2 AND color = $3 AND size = $4",
  [customer_id, product_id, color, size]
);

  let cartId = null;
  if (existing.rows.length > 0) {
    const upd = await db.query(
      "UPDATE cart SET quantity = quantity + $1 WHERE customer_id = $2 AND product_id = $3 AND color = $4 AND size = $5 RETURNING id",
      [quantity, customer_id, product_id, color, size]
    );
    if (upd.rows && upd.rows[0]) cartId = upd.rows[0].id;
  } else {
    const ins = await db.query(
      "INSERT INTO cart (customer_id, product_id, quantity, color, size) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [customer_id, product_id, quantity, color, size]
    );
    if (ins.rows && ins.rows[0]) cartId = ins.rows[0].id;
  }

  // Return the cart row id for client-side flows (buy-now needs to know the specific cart item)
  if (cartId) {
    return res.json({ ok: true, cart_id: cartId });
  } else {
    // Fallback to generic success
    return res.json({ ok: true });
  }
  } catch (err) {
    console.error("Error adding to cart:", err);
    res.sendStatus(500);
  }
});

// ✅ Cart count for header (public: returns 0 for guests)
router.get("/count", async (req, res) => {
  try {
    if (!req.session || !req.session.user) {
      return res.json({ count: 0 });
    }
    const result = await db.query(
      "SELECT SUM(quantity) AS total FROM cart WHERE customer_id = $1",
      [req.session.user.id]
    );
    res.json({ count: result.rows[0].total || 0 });
  } catch (err) {
    console.error(err);
    res.json({ count: 0 });
  }
});

// ✅ Remove item
router.post("/remove", requireActiveUser, async (req, res) => {
  const { product_id, color, size } = req.body;
  const customer_id = req.session.user.id;

  try {
    await db.query(
      "DELETE FROM cart WHERE customer_id = $1 AND product_id = $2 AND color = $3 AND size = $4",
      [customer_id, product_id, color || null, size || null]
    );
    res.redirect("/cart");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error removing item");
  }
});

// ✅ Update quantity
router.post("/update", requireActiveUser, async (req, res) => {
  const { product_id, quantity, action, color, size } = req.body;
  const customer_id = req.session.user.id;
  let newQty = parseInt(quantity);

  if (action === "plus") newQty += 1;
  if (action === "minus" && newQty > 1) newQty -= 1;

  try {
    // Cap by per-variant stock if available
    let maxStock = null;
    try {
      if (size && color) {
        const ss = await db.query(
          `SELECT stock FROM product_variants WHERE product_id = $1 AND UPPER(size) = UPPER($2) AND LOWER(color) = LOWER($3)`,
          [product_id, size, color]
        );
        if (ss.rows.length) maxStock = Number(ss.rows[0].stock || 0);
      }
    } catch(_) {}
    if (maxStock === null) {
      try {
        const ps = await db.query(`SELECT COALESCE(SUM(stock),0) AS total FROM product_variants WHERE product_id = $1`, [product_id]);
        if (ps.rows.length) maxStock = Number(ps.rows[0].total || 0);
      } catch(_) {}
    }
    if (maxStock !== null && maxStock >= 0) {
      if (newQty > maxStock) newQty = maxStock;
    }

    await db.query(
      "UPDATE cart SET quantity = $1 WHERE customer_id = $2 AND product_id = $3 AND color = $4 AND size = $5",
      [newQty, customer_id, product_id, color || null, size || null]
    );
    res.redirect("/cart");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating quantity");
  }
});

// ✅ Clear cart
router.post("/clear", requireActiveUser, async (req, res) => {
  const customer_id = req.session.user.id;

  try {
    await db.query("DELETE FROM cart WHERE customer_id = $1", [customer_id]);
    res.redirect("/cart");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error clearing cart");
  }
})


export default router;
