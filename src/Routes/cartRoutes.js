import express from "express";
import db from "../database/db.js";
const router = express.Router();

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ✅ View cart
router.get("/", isAuthenticated, async (req, res) => {
  const customer_id = req.session.user.id;
  try {
    const cartItems = await db.query(
      `SELECT c.id, c.quantity, c.color, c.size,
              p.id AS product_id,
              p.name AS product_name, 
              p.price, 
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
router.post("/add", isAuthenticated, async (req, res) => {
  console.log("BODY RECEIVED:", req.body);

  let { product_id, color, size, quantity } = req.body;

  product_id = parseInt(product_id);
  quantity = parseInt(quantity) || 1;
  const customer_id = req.session.user.id;

  if (!product_id) {
    return res.status(400).send("Please select a product");
  }

  try {
const existing = await db.query(
  "SELECT * FROM cart WHERE customer_id = $1 AND product_id = $2 AND color = $3 AND size = $4",
  [customer_id, product_id, color, size]
);

if (existing.rows.length > 0) {
  await db.query(
    "UPDATE cart SET quantity = quantity + $1 WHERE customer_id = $2 AND product_id = $3 AND color = $4 AND size = $5",
    [quantity, customer_id, product_id, color, size]
  );
} else {
  await db.query(
    "INSERT INTO cart (customer_id, product_id, quantity, color, size) VALUES ($1, $2, $3, $4, $5)",
    [customer_id, product_id, quantity, color, size]
  );
}

    res.sendStatus(200);
  } catch (err) {
    console.error("Error adding to cart:", err);
    res.sendStatus(500);
  }
});

// ✅ Cart count for header
router.get("/count", isAuthenticated, async (req, res) => {
  try {
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
router.post("/remove", isAuthenticated, async (req, res) => {
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
router.post("/update", isAuthenticated, async (req, res) => {
  const { product_id, quantity, action, color, size } = req.body;
  const customer_id = req.session.user.id;
  let newQty = parseInt(quantity);

  if (action === "plus") newQty += 1;
  if (action === "minus" && newQty > 1) newQty -= 1;

  try {
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
router.post("/clear", isAuthenticated, async (req, res) => {
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
