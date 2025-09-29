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
    `SELECT c.id, c.quantity, 
            p.id AS product_id, 
            p.name AS product_name, 
            p.price, 
            p.image_url
     FROM cart c
     JOIN products p ON c.product_id = p.id
     WHERE c.customer_id=$1
     ORDER BY c.id DESC`,
    [customerId]
  );
  return result.rows;
}

function calculateCartTotal(cartItems) {
  let subtotal = 0;
  cartItems.forEach(item => subtotal += item.price * item.quantity);
  const tax = Math.round(subtotal * 0.12);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

// --------------------------
// GET /checkout — show checkout page
// --------------------------
// GET /checkout — show checkout page
router.get("/", isAuthenticated, async (req, res) => {
  try {
    const customer_id = req.session.user.id;

    // Fetch cart items
    const cartItems = await getCartItems(customer_id);
    const { subtotal, tax, total } = calculateCartTotal(cartItems);

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
      total
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
  const { firstName, lastName, address, city, province, zip, phone, email, payment_method } = req.body;

  try {
    const cartItems = await getCartItems(customer_id);

    if (cartItems.length === 0) {
      return res.json({ success: false, error: "Cart is empty" });
    }

    const { subtotal, tax, total } = calculateCartTotal(cartItems);

    // Insert order
    const orderResult = await db.query(
      `INSERT INTO orders
        (customer_id, first_name, last_name, address, city, province, zipcode, phone, email, payment_method, subtotal, tax, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'completed')
       RETURNING id`,
      [customer_id, firstName, lastName, address, city, province, zip, phone, email, payment_method, subtotal, tax, total]
    );

    const orderId = orderResult.rows[0].id;

    // Insert order items
    for (const item of cartItems) {
      await db.query(
        `INSERT INTO order_items (order_id, product_name, quantity, price, image_url)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.product_name, item.quantity, item.price, item.image_url]
      );
    }

    // Clear cart
    await db.query("DELETE FROM cart WHERE customer_id=$1", [customer_id]);

    res.json({ success: true, orderId });
  } catch (err) {
    console.error("Place order error:", err);
    res.json({ success: false, error: "Server error while placing order" });
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

    res.render("customer/orderConfirmation", {
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
