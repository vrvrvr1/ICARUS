// routes/adminRoutes.js
import express from "express";
import db from "../database/db.js"; // PostgreSQL connection
import { requireAdmin } from "../Middleware/authMiddleware.js";
import multer from "multer";
import path from "path";

const router = express.Router();

// ================== MULTER SETUP ==================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "src/public/uploads/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage });

// ================== ADMIN PRODUCTS ==================
router.get("/adminproducts", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, name, price::float AS price, stock, category, image_url FROM products ORDER BY id ASC"
    );

    const products = result.rows.map(p => ({
      ...p,
      price: p.price !== null ? Number(p.price) : 0,
    }));

    res.render("admin/adminProducts", { products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).send("Server Error");
  }
});

// ================== ADD PRODUCT ==================
router.get("/addproduct", (req, res) => {
  res.render("admin/addProduct");
});

// POST route with image upload
router.post("/addproduct", upload.single("image"), async (req, res) => {
  try {
    const { name, price, stock, category, sizes, color } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

await db.query(
  `INSERT INTO products (name, price, stock, category, image_url, sizes, colors)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [name, price, stock, category, image, sizes, color]
);


    res.redirect("/adminproducts");
  } catch (err) {
    console.error("Error adding product:", err);
    res.status(500).send("Server Error");
  }
});

// ================== CUSTOMERS ==================
router.get("/customers", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM customers ORDER BY id DESC");
    res.render("admin/customers", { customers: result.rows });
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).send("Server Error");
  }
});

// ================== LOGOUT ==================
router.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.status(500).send("Server Error");
    }
    res.redirect("/login");
  });
});

// ================== VIEW SINGLE PRODUCT ==================
router.get("/adminproducts/:id", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    res.render("admin/viewProducts", { product: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).send("Server Error");
  }
});

// ================== EDIT PRODUCT ==================
router.get("/adminproducts/:id/edit", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    res.render("admin/editProducts", { product: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).send("Server Error");
  }
});

// POST update product with optional image
router.post("/adminproducts/:id/edit", upload.single("image"), async (req, res) => {
  try {
    const { name, price, stock, category, sizes, color } = req.body;
    const productId = req.params.id;

    // Update query dynamically if image uploaded
    if (req.file) {
      const image = `/uploads/${req.file.filename}`;
      await db.query(
        `UPDATE products SET name=$1, price=$2, stock=$3, category=$4, image_url=$5, sizes=$6, color=$7 WHERE id=$8`,
        [name, price, stock, category, image, sizes, color, productId]
      );
    } else {
      await db.query(
        `UPDATE products SET name=$1, price=$2, stock=$3, category=$4, sizes=$5, color=$6 WHERE id=$7`,
        [name, price, stock, category, sizes, color, productId]
      );
    }

    res.redirect("/adminproducts");
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).send("Server Error");
  }
});

// ================== DELETE PRODUCT ==================
router.post("/adminproducts/:id/delete", async (req, res) => {
  try {
    await db.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.redirect("/adminproducts");
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).send("Server Error");
  }
});

// ================== ADMIN DASHBOARD ==================
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    // Total revenue
    const revenueResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * p.price), 0) AS revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
    `);
    const totalRevenue = revenueResult.rows[0].revenue;

    // Total orders
    const ordersResult = await db.query("SELECT COUNT(*) AS count FROM orders");
    const totalOrders = ordersResult.rows[0].count;

    // Top 3 products sold
    const topProductsResult = await db.query(`
      SELECT p.name, SUM(oi.quantity) as total_sold
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      GROUP BY p.name
      ORDER BY total_sold DESC
      LIMIT 3
    `);

    // Recent orders
    const recentOrdersResult = await db.query(`
      SELECT o.id, (c.first_name || ' ' || c.last_name) AS customer_name, o.order_date, o.status
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      ORDER BY o.order_date DESC
      LIMIT 5
    `);

    res.render("admin/admin", {
      user: req.session.user,
      revenue: totalRevenue,
      totalOrders,
      topProducts: topProductsResult.rows,
      recentOrders: recentOrdersResult.rows
    });
  } catch (err) {
    console.error("❌ Error fetching admin data:", err);
    res.status(500).send("Server Error");
  }
});

// ================== ORDERS ==================
router.get("/orders", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        o.id, 
        o.status, 
        o.order_date, 
        (c.first_name || ' ' || c.last_name) AS customer_name, 
        c.email AS customer_email,
        COALESCE(SUM(oi.quantity * p.price), 0)::float AS total_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      GROUP BY o.id, c.first_name, c.last_name, c.email, o.status, o.order_date
      ORDER BY o.order_date DESC
    `);

    res.render("admin/orders", { orders: result.rows });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
