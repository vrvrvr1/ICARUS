// routes/paymentRoutes.js
import express from "express";
import db from "../database/db.js";

const router = express.Router();
function isAuthenticated(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}


// Show payment page
router.get("/payment", isAuthenticated, async (req, res) => {
  const customer_id = req.session.user.id;

  try {
    // Optional: fetch the latest order for the user
    const orderQ = await db.query(
      `SELECT id, total, status
       FROM orders
       WHERE customer_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [customer_id]
    );

    const order = orderQ.rows[0];

    if (!order) {
      return res.redirect("/checkout"); // no order found, back to checkout
    }

    res.render("customer/payment", {
      order,
      cartItems: req.session.cart || [],
    });
  } catch (err) {
    console.error("ERROR loading payment page:", err);
    res.status(500).send("Error loading payment page");
  }
});

export default router;
