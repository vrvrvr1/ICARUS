import express from "express";
import db from "../database/db.js"; // PostgreSQL connection
import { requireAdmin } from "../Middleware/authMiddleware.js";
import multer from "multer";
import path from "path";

const router = express.Router();

// ================== MULTER SETUP ==================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "src/public/uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ================== ADMIN PRODUCTS ==================
router.get("/adminproducts", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.id, 
        p.name, 
        p.price, 
        p.stock, 
        p.category, 
        p.image_url,
        COALESCE(SUM(oi.quantity), 0) AS sold
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id
      ORDER BY p.id ASC
    `);

    const products = result.rows.map(product => ({
      ...product,
      sold: Number(product.sold)
    }));

    res.render("admin/adminProducts", { products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).send("Server Error");
  }
});

// ================== ADD PRODUCT ==================
router.get("/addproduct", (req, res) => res.render("admin/addProduct"));

router.post("/addproduct", upload.fields([
  { name: 'image0', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 },
  { name: 'image3', maxCount: 1 }
]), async (req, res) => {
  try {
  const { name, price, stock, category } = req.body;
  // colors may come as colors[] or color
  let colorsRaw = req.body['colors[]'] || req.body.colors || req.body.color;
  let colorsCsv = '';
  if (Array.isArray(colorsRaw)) colorsCsv = colorsRaw.join(',');
  else if (typeof colorsRaw === 'string' && colorsRaw.trim()) colorsCsv = colorsRaw;

  // sizes may come as sizes[] or sizes (string)
  let sizesRaw = req.body['sizes[]'] || req.body.sizes || req.body.size;
  let sizesCsv = '';
  if (Array.isArray(sizesRaw)) sizesCsv = sizesRaw.join(',');
  else if (typeof sizesRaw === 'string' && sizesRaw.trim()) sizesCsv = sizesRaw;

    const priceInt = Math.round(Number(price));

    const files = req.files || {};
    const img0 = files.image0 && files.image0[0] ? `/uploads/${files.image0[0].filename}` : null;
    const img1 = files.image1 && files.image1[0] ? `/uploads/${files.image1[0].filename}` : null;
    const img2 = files.image2 && files.image2[0] ? `/uploads/${files.image2[0].filename}` : null;
    const img3 = files.image3 && files.image3[0] ? `/uploads/${files.image3[0].filename}` : null;

    await db.query(
      `INSERT INTO products (name, price, stock, category, image_url, image_url_2, image_url_3, image_url_4, sizes, colors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [name, priceInt, stock, category, img0, img1, img2, img3, sizesCsv, colorsCsv]
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
    const result = await db.query(
      "SELECT id, email, first_name, last_name, role FROM customers ORDER BY id DESC"
    );
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
  const productId = Number(req.params.id);
  if (isNaN(productId)) return res.status(400).send("Invalid product ID");

  try {
    const result = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [productId]
    );
    const product = result.rows[0];
    if (!product) return res.status(404).send('Product not found');

    // compute units sold and revenue for this product from order_items
    const salesResult = await db.query(
      `SELECT COALESCE(SUM(quantity),0) AS units_sold, COALESCE(SUM(quantity * price),0) AS revenue
       FROM order_items WHERE product_id = $1`,
      [productId]
    );
    const stats = salesResult.rows[0] || { units_sold: 0, revenue: 0 };
    product.sold = Number(stats.units_sold || 0);
    product.revenue = Number(stats.revenue || 0);

    // recent orders that include this product (last 10)
    const recentProductOrders = await db.query(`
      SELECT o.id AS order_id, o.order_date, oi.quantity, oi.price, (c.first_name || ' ' || c.last_name) AS customer_name, o.status
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      WHERE oi.product_id = $1
      ORDER BY o.order_date DESC
      LIMIT 10
    `, [productId]);
    product.recentOrders = recentProductOrders.rows || [];

    res.render("admin/viewProducts", { product });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).send("Server Error");
  }
});

// quick stock update endpoint (used by Inventory tab)
router.post('/adminproducts/:id/stock', async (req, res) => {
  const productId = Number(req.params.id);
  const { stock } = req.body;
  if (isNaN(productId)) return res.status(400).send('Invalid product ID');
  try {
    await db.query('UPDATE products SET stock = $1 WHERE id = $2', [stock, productId]);
    res.redirect(`/adminproducts/${productId}`);
  } catch (err) {
    console.error('Error updating stock:', err);
    res.status(500).send('Server Error');
  }
});

// ================== EDIT PRODUCT ==================
router.get("/adminproducts/:id/edit", async (req, res) => {
  const productId = Number(req.params.id);
  if (isNaN(productId)) return res.status(400).send("Invalid product ID");

  try {
    const result = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [productId]
    );
    res.render("admin/editProducts", { product: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).send("Server Error");
  }
});

router.post("/adminproducts/:id/edit", upload.fields([
  { name: 'image0', maxCount: 1 },
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 },
  { name: 'image3', maxCount: 1 }
]), async (req, res) => {
  const productId = Number(req.params.id);
  if (isNaN(productId)) return res.status(400).send("Invalid product ID");

  try {
    const { name, price, stock, category } = req.body;
    // accept colors[] (from multi-checkbox) or colors
    let colorsRaw = req.body['colors[]'] || req.body.colors || req.body.color;
    // normalize to CSV string for DB (empty string if none)
    let colorsCsv = '';
    if (Array.isArray(colorsRaw)) colorsCsv = colorsRaw.join(',');
    else if (typeof colorsRaw === 'string' && colorsRaw.trim()) colorsCsv = colorsRaw;

    // normalize sizes[] to CSV
    let sizesRaw = req.body['sizes[]'] || req.body.sizes || req.body.size;
    let sizesCsv = '';
    if (Array.isArray(sizesRaw)) sizesCsv = sizesRaw.join(',');
    else if (typeof sizesRaw === 'string' && sizesRaw.trim()) sizesCsv = sizesRaw;

    const priceInt = Math.round(Number(price));

    const files = req.files || {};
    const f0 = files.image0 && files.image0[0] ? `/uploads/${files.image0[0].filename}` : null;
    const f1 = files.image1 && files.image1[0] ? `/uploads/${files.image1[0].filename}` : null;
    const f2 = files.image2 && files.image2[0] ? `/uploads/${files.image2[0].filename}` : null;
    const f3 = files.image3 && files.image3[0] ? `/uploads/${files.image3[0].filename}` : null;

    // Build update query dynamically: only overwrite image columns when new files are provided
    if (f0 || f1 || f2 || f3) {
      // fetch existing images to preserve missing slots
      const existing = await db.query('SELECT image_url, image_url_2, image_url_3, image_url_4 FROM products WHERE id=$1', [productId]);
      const ex = existing.rows[0] || {};
      const img0 = f0 || ex.image_url || null;
      const img1 = f1 || ex.image_url_2 || null;
      const img2 = f2 || ex.image_url_3 || null;
      const img3 = f3 || ex.image_url_4 || null;

      await db.query(
        `UPDATE products SET name=$1, price=$2, stock=$3, category=$4, image_url=$5, image_url_2=$6, image_url_3=$7, image_url_4=$8, sizes=$9, colors=$10 WHERE id=$11`,
        [name, priceInt, stock, category, img0, img1, img2, img3, sizesCsv, colorsCsv, productId]
      );
    } else {
      await db.query(
        `UPDATE products SET name=$1, price=$2, stock=$3, category=$4, sizes=$5, colors=$6 WHERE id=$7`,
        [name, priceInt, stock, category, sizesCsv, colorsCsv, productId]
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
  const productId = Number(req.params.id);
  if (isNaN(productId)) return res.status(400).send("Invalid product ID");

  try {
    await db.query("DELETE FROM products WHERE id = $1", [productId]);
    res.redirect("/adminproducts");
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).send("Server Error");
  }
});

// Delete a specific image slot for a product (AJAX)
router.delete('/adminproducts/:id/image/:slot', async (req, res) => {
  const productId = Number(req.params.id);
  const slot = req.params.slot; // expected values: 0,1,2,3
  if (isNaN(productId)) return res.status(400).send('Invalid product ID');
  const colMap = { '0': 'image_url', '1': 'image_url_2', '2': 'image_url_3', '3': 'image_url_4' };
  const col = colMap[slot];
  if (!col) return res.status(400).send('Invalid slot');
  try {
    await db.query(`UPDATE products SET ${col} = NULL WHERE id = $1`, [productId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting product image slot:', err);
    res.status(500).json({ ok: false });
  }
});

// ================== ADMIN DASHBOARD ==================
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    // Total revenue from order_items
    const revenueResult = await db.query(`
      SELECT COALESCE(SUM(quantity * price), 0) AS revenue
      FROM order_items
    `);
    const totalRevenue = revenueResult.rows[0].revenue;

  // Total orders
  const ordersResult = await db.query("SELECT COUNT(*) AS count FROM orders");
  const totalOrders = ordersResult.rows[0].count;

  // Customers count
  const customersResult = await db.query("SELECT COUNT(*) AS count FROM customers");
  const customersCount = customersResult.rows[0].count;

    // Top selling products (with image)
    // Return top 3 products for the side panel using canonical product records
    const topProductsResult = await db.query(`
      SELECT p.id, p.name, p.image_url, COALESCE(SUM(oi.quantity),0) as total_sold
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      GROUP BY p.id, p.name, p.image_url
      ORDER BY total_sold DESC
      LIMIT 3
    `);

    // Recent orders with total amount and a representative product image
    const recentOrdersResult = await db.query(`
      SELECT o.id,
             (c.first_name || ' ' || c.last_name) AS customer_name,
             o.order_date,
             o.status,
             COALESCE(SUM(oi.quantity * oi.price),0) AS total_amount,
             c.profile_image AS customer_image
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, c.first_name, c.last_name, o.order_date, o.status, c.profile_image
      ORDER BY o.order_date DESC
      LIMIT 5
    `);

    // Monthly revenue (last 12 months, including zero months)
    const monthlyRevenueResult = await db.query(`
      SELECT to_char(m, 'Mon YYYY') AS month,
             COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM generate_series(
        date_trunc('month', current_date) - interval '11 months',
        date_trunc('month', current_date),
        '1 month'
      ) AS m
      LEFT JOIN orders o ON date_trunc('month', o.order_date) = m
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY m
      ORDER BY m
    `);

    // Compute simple month-over-month growth for the most recent month vs previous month
    const monthlyRevenueRows = monthlyRevenueResult.rows.map(r => Number(r.revenue || 0));
    let revenueGrowthText = '+0%';
    let revenueGrowthClass = 'positive';
    if (monthlyRevenueRows.length >= 2) {
      const last = monthlyRevenueRows[monthlyRevenueRows.length - 1];
      const prev = monthlyRevenueRows[monthlyRevenueRows.length - 2];
      let growth = 0;
      if (prev === 0) {
        growth = last === 0 ? 0 : 100; // show 100% if previous was zero but now there is revenue
      } else {
        growth = ((last - prev) / prev) * 100;
      }
      const rounded = Math.round(growth * 10) / 10; // 1 decimal
      revenueGrowthText = (rounded >= 0 ? '+' : '') + rounded + '%';
      revenueGrowthClass = rounded >= 0 ? 'positive' : 'negative';
    }

    // Monthly orders count (last 12 months, including zero months)
    const monthlyOrdersResult = await db.query(`
      SELECT to_char(m, 'Mon YYYY') AS month,
             COALESCE(COUNT(DISTINCT o.id), 0) AS orders
      FROM generate_series(
        date_trunc('month', current_date) - interval '11 months',
        date_trunc('month', current_date),
        '1 month'
      ) AS m
      LEFT JOIN orders o ON date_trunc('month', o.order_date) = m
      GROUP BY m
      ORDER BY m
    `);

    // Monthly units sold (sum of quantities)
    const monthlyUnitsResult = await db.query(`
      SELECT to_char(m, 'Mon YYYY') AS month,
             COALESCE(SUM(oi.quantity), 0) AS units
      FROM generate_series(
        date_trunc('month', current_date) - interval '11 months',
        date_trunc('month', current_date),
        '1 month'
      ) AS m
      LEFT JOIN orders o ON date_trunc('month', o.order_date) = m
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY m
      ORDER BY m
    `);

    // Category distribution (if you want, you can join with products for category)
    const categoryDistributionResult = await db.query(`
      SELECT p.category, COALESCE(SUM(oi.quantity),0) AS total_sold
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.category
      ORDER BY total_sold DESC
    `);

    // Weekly category distribution for sales view (last 7 days revenue per category)
    const weeklyCategoryDistributionResult_sales = await db.query(`
      SELECT p.category, COALESCE(SUM(oi.quantity * oi.price),0) AS revenue
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE o.order_date >= date_trunc('day', current_date) - interval '6 days'
      GROUP BY p.category
      ORDER BY revenue DESC
    `);

    // Weekly category distribution for admin dashboard (last 7 days revenue per category)
    const weeklyCategoryDistributionResult_admin = await db.query(`
      SELECT p.category, COALESCE(SUM(oi.quantity * oi.price),0) AS revenue
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE o.order_date >= date_trunc('day', current_date) - interval '6 days'
      GROUP BY p.category
      ORDER BY revenue DESC
    `);

    

    // Daily sales (today)
    const dailySalesResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS daily_sales
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.order_date >= date_trunc('day', current_date)
    `);
    const dailySales = Number(dailySalesResult.rows[0].daily_sales || 0);

    // Weekly sales (last 7 days)
    const weeklySalesResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS weekly_sales
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.order_date >= date_trunc('day', current_date) - interval '6 days'
    `);
    const weeklySales = Number(weeklySalesResult.rows[0].weekly_sales || 0);

    // Weekly orders count
    const weeklyOrdersCountResult = await db.query(`
      SELECT COUNT(DISTINCT o.id) AS weekly_orders
      FROM orders o
      WHERE o.order_date >= date_trunc('day', current_date) - interval '6 days'
    `);
    const weeklyOrdersCount = Number(weeklyOrdersCountResult.rows[0].weekly_orders || 0);

    // Fetch products to display in 'Most Popular Products' table
    const productsResult = await db.query(`
      SELECT id, name, price, stock
      FROM products
      ORDER BY id ASC
      LIMIT 12
    `);

    // Products count
    const productsCountResult = await db.query("SELECT COUNT(*) AS count FROM products");
    const productsCount = productsCountResult.rows[0].count;

    res.render("admin/admin", {
      user: req.session.user,
      revenue: totalRevenue,
  totalOrders,
  customersCount,
  productsCount,
  topProducts: topProductsResult.rows,
  recentOrders: recentOrdersResult.rows,
      analytics: {
        monthlyRevenue: monthlyRevenueResult.rows,
        monthlyOrders: monthlyOrdersResult.rows,
        monthlyUnits: monthlyUnitsResult.rows,
        categoryDistribution: categoryDistributionResult.rows,
        revenueGrowthText,
        revenueGrowthClass
      },
      products: productsResult.rows
    });
  } catch (err) {
    console.error("❌ Error fetching admin data:", err);
    res.status(500).send("Server Error");
  }
});

// ---------- SALES OVERVIEW ROUTE ----------
router.get("/admin/sales", requireAdmin, async (req, res) => {
  try {
    // ====== 1. TOTAL, WEEKLY, DAILY SALES ======
    const totalRevenueResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS total_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id;
    `);

    const weeklySalesResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS total_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.order_date >= NOW() - INTERVAL '7 days';
    `);

    const dailySalesResult = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS total_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.order_date) = CURRENT_DATE;
    `);

    const weeklyOrdersResult = await db.query(`
      SELECT COUNT(DISTINCT o.id) AS order_count
      FROM orders o
      WHERE o.order_date >= NOW() - INTERVAL '7 days';
    `);

    // ====== 2. MONTHLY REVENUE (LAST 12 MONTHS) ======
    const monthlyRevenueResult = await db.query(`
      SELECT TO_CHAR(m, 'Mon YYYY') AS month,
             COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM GENERATE_SERIES(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months',
        DATE_TRUNC('month', CURRENT_DATE),
        '1 month'
      ) AS m
      LEFT JOIN orders o ON DATE_TRUNC('month', o.order_date) = m
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY m
      ORDER BY m;
    `);

    // ====== 3. CATEGORY DISTRIBUTION (TOTAL) ======
    const categoryDistributionResult = await db.query(`
      SELECT p.category,
             SUM(oi.quantity * oi.price) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      GROUP BY p.category
      ORDER BY revenue DESC;
    `);

    // ====== 4. WEEKLY CATEGORY DISTRIBUTION (7 DAYS) ======
    const weeklyCategoryDistributionResult_sales = await db.query(`
      SELECT p.category,
             SUM(oi.quantity * oi.price) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.order_date >= NOW() - INTERVAL '7 days'
      GROUP BY p.category
      ORDER BY revenue DESC;
    `);

    // ====== 5. THIS WEEK VS LAST WEEK ======
    const currentWeekResult = await db.query(`
      SELECT to_char(d, 'Dy') AS day,
             COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM generate_series(
        date_trunc('week', current_date),
        date_trunc('week', current_date) + interval '6 days',
        '1 day'
      ) AS d
      LEFT JOIN orders o ON date_trunc('day', o.order_date) = d
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY d
      ORDER BY d;
    `);

    const previousWeekResult = await db.query(`
      SELECT to_char(d, 'Dy') AS day,
             COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM generate_series(
        date_trunc('week', current_date) - interval '7 days',
        date_trunc('week', current_date) - interval '1 day',
        '1 day'
      ) AS d
      LEFT JOIN orders o ON date_trunc('day', o.order_date) = d
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY d
      ORDER BY d;
    `);

    // ====== 6. WEEKLY GROWTH PERCENTAGE ======
    const currentWeekRevenue = currentWeekResult.rows.reduce((sum, x) => sum + Number(x.revenue || 0), 0);
    const previousWeekRevenue = previousWeekResult.rows.reduce((sum, x) => sum + Number(x.revenue || 0), 0);

    const weekGrowth = previousWeekRevenue > 0
      ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100
      : 0;

    const weekGrowthText = (weekGrowth >= 0 ? "+" : "") + weekGrowth.toFixed(1) + "%";
    const weekGrowthClass = weekGrowth >= 0 ? "positive" : "negative";

    // ====== 7. FINAL ANALYTICS OBJECT ======
    const analytics = {
      monthlyRevenue: monthlyRevenueResult.rows,
      categoryDistribution: categoryDistributionResult.rows,
      weeklyCategoryDistribution: weeklyCategoryDistributionResult_sales.rows,
      currentWeek: currentWeekResult.rows,
      previousWeek: previousWeekResult.rows,
      weekGrowthText,
      weekGrowthClass
    };

    // ====== 8. RENDER PAGE ======
    res.render("admin/sales", {
      user: req.session.user,
      revenue: totalRevenueResult.rows[0].total_sales,
      weeklySales: weeklySalesResult.rows[0].total_sales,
      dailySales: dailySalesResult.rows[0].total_sales,
      weeklyOrdersCount: weeklyOrdersResult.rows[0].order_count,
      analytics
    });

  } catch (err) {
    console.error("❌ Error rendering sales page:", err);
    res.status(500).render("error", { message: "Failed to load sales data." });
  }
});

export default router;