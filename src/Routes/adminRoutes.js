import express from "express";
import db from "../database/db.js"; // PostgreSQL connection
import storeConfig from "../utils/storeConfig.js";
import { requireAdmin } from "../Middleware/authMiddleware.js";
import multer from "multer";
import path from "path";

const router = express.Router();

// ================== HELPERS ==================
let discountsTableEnsured = false;
async function ensureDiscountsTable() {
  if (discountsTableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS discounts (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
        value NUMERIC NOT NULL CHECK (value >= 0),
        start_date TIMESTAMPTZ NULL,
        end_date TIMESTAMPTZ NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        min_order NUMERIC DEFAULT 0,
        max_uses INTEGER NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Link table: discounts ↔ products (scope a discount to specific products)
    await db.query(`
      CREATE TABLE IF NOT EXISTS discount_products (
        discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        PRIMARY KEY (discount_id, product_id)
      );
    `);
    discountsTableEnsured = true;
  } catch (e) {
    // If DB user has no DDL rights, ignore; routes will fail gracefully
    console.warn('Discounts table ensure failed (may already exist or insufficient privileges):', e.message);
  }
}

let announcementsTableEnsured = false;
async function ensureAnnouncementsTable() {
  if (announcementsTableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Add optional ecommerce fields if missing
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS link_url TEXT`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS button_text TEXT`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS coupon_code TEXT`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NULL`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ NULL`);
    await db.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS placement TEXT DEFAULT 'modal'`);
    announcementsTableEnsured = true;
  } catch (e) {
    console.warn('Announcements table ensure failed:', e.message);
  }
}

let auditLogsTableEnsured = false;
async function ensureAuditLogsTable() {
  if (auditLogsTableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NULL REFERENCES customers(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        meta JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    auditLogsTableEnsured = true;
  } catch (e) {
    console.warn('Audit logs table ensure failed:', e.message);
  }
}

// CMS pages ensure
let cmsTableEnsured = false;
async function ensureCmsTable() {
  if (cmsTableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cms_pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    cmsTableEnsured = true;
  } catch (e) {
    console.warn('CMS table ensure failed:', e.message);
  }
}

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
        p.category,
        p.image_url,
        COALESCE(SUM(oi.quantity), 0) AS sold,
        COALESCE(ps.total_stock, 0) AS stock
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN (
        SELECT product_id, SUM(stock) AS total_stock
        FROM product_variants
        GROUP BY product_id
      ) ps ON ps.product_id = p.id
      GROUP BY p.id, ps.total_stock
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

  let colorsRaw = req.body['colors[]'] || req.body.colors || req.body.color;
  let colorsCsv = '';
  if (Array.isArray(colorsRaw)) colorsCsv = colorsRaw.join(',');
  else if (typeof colorsRaw === 'string' && colorsRaw.trim()) colorsCsv = colorsRaw;

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

    const ins = await db.query(
      `INSERT INTO products (name, price, category, image_url, image_url_2, image_url_3, image_url_4, sizes, colors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [name, priceInt, category, img0, img1, img2, img3, sizesCsv, colorsCsv]
    );

    // Insert per-variant stock if provided: distribute per-size stock across all selected colors
    try {
      const pid = ins.rows && ins.rows[0] ? Number(ins.rows[0].id) : null;
      const sizeStock = req.body['size_stock'] || {};
      const colorsList = colorsCsv ? colorsCsv.split(',').map(s=>s.trim()).filter(Boolean) : [];
      const allowedSizes = new Set(['S','M','L','XL']);
      if (pid && sizeStock && typeof sizeStock === 'object' && colorsList.length) {
        for (const [sz, val] of Object.entries(sizeStock)) {
          const v = Math.max(0, parseInt(val));
          if (!Number.isNaN(v)) {
            const sizeUC = String(sz).toUpperCase();
            if (!allowedSizes.has(sizeUC)) continue; // respect CHECK constraint in schema
            for (const col of colorsList) {
              const colorLC = String(col).toLowerCase();
              const upd = await db.query(
                `UPDATE product_variants SET stock = $4 WHERE product_id = $1 AND LOWER(color) = LOWER($2) AND UPPER(size) = UPPER($3)`,
                [pid, colorLC, sizeUC, v]
              );
              if ((upd.rowCount || 0) === 0) {
                await db.query(
                  `INSERT INTO product_variants (product_id, color, size, stock) VALUES ($1, $2, $3, $4)`,
                  [pid, colorLC, sizeUC, v]
                );
              }
            }
          }
        }
      }
    } catch(_) { /* ignore if table missing */ }

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
      "SELECT id, email, first_name, last_name, role, profile_image FROM customers ORDER BY id DESC"
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

    // Compute total stock from product_variants (if available)
    try {
      const s = await db.query(`SELECT COALESCE(SUM(stock),0) AS total FROM product_variants WHERE product_id = $1`, [productId]);
      product.stock = Number(s.rows[0]?.total || 0);
    } catch (_) {
      // ignore if table missing
    }

    // compute units sold and revenue for this product from order_items
    const salesResult = await db.query(
      `SELECT COALESCE(SUM(quantity),0) AS units_sold, COALESCE(SUM(quantity * price),0) AS revenue
       FROM order_items WHERE product_id = $1`,
      [productId]
    );
    const stats = salesResult.rows[0] || { units_sold: 0, revenue: 0 };
    product.sold = Number(stats.units_sold || 0);
    product.revenue = Number(stats.revenue || 0);

    // Fetch reviews and breakdown for this product
    let reviews = [];
    try {
      const rv = await db.query(
        `SELECT pr.id, pr.user_id, pr.rating, pr.comment, pr.created_at,
                COALESCE(c.first_name || ' ' || c.last_name, NULL) AS user_name,
                c.profile_image AS user_avatar
           FROM product_reviews pr
           LEFT JOIN customers c ON pr.user_id = c.id
          WHERE pr.product_id = $1
          ORDER BY pr.created_at DESC
          LIMIT 20`,
        [productId]
      );
      reviews = rv.rows || [];

      const bd = await db.query(
        `SELECT rating, COUNT(*) AS count
           FROM product_reviews
          WHERE product_id = $1
          GROUP BY rating`,
        [productId]
      );
      const map = {1:0,2:0,3:0,4:0,5:0};
      for (const row of bd.rows) {
        const r = Number(row.rating);
        const c = Number(row.count);
        if (r>=1 && r<=5) map[r] = c;
      }
      const total = Object.values(map).reduce((a,b)=>a+b,0);
      product.reviewBreakdown = { counts: map, total };
    } catch (err) {
      // If review table missing or error, proceed without reviews
      reviews = [];
      product.reviewBreakdown = { counts: {1:0,2:0,3:0,4:0,5:0}, total: 0 };
    }

    res.render("admin/viewProducts", { product, reviews });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).send("Server Error");
  }
});

// quick stock update endpoint (used by Inventory tab)
router.post('/adminproducts/:id/stock', async (req, res) => {
  // Product-level stock column removed; edit per-size stock on the product edit page instead.
  const productId = Number(req.params.id);
  if (isNaN(productId)) return res.status(400).send('Invalid product ID');
  return res.status(400).send('Product-level stock is managed per-size. Use the per-size fields in Edit Product.');
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
    const product = result.rows[0];
    // pull discounts + currently attached discounts
    try {
      await ensureDiscountsTable();
      const all = await db.query('SELECT * FROM discounts ORDER BY id DESC');
      const attached = await db.query('SELECT discount_id FROM discount_products WHERE product_id = $1', [productId]);
      const productDiscountIds = new Set((attached.rows || []).map(r => Number(r.discount_id)));
      // Aggregate per-size stock across colors to prefill the simple UI
      let sizeStock = {};
      try {
        const ss = await db.query('SELECT UPPER(size) AS size, COALESCE(SUM(stock),0) AS stock FROM product_variants WHERE product_id = $1 GROUP BY size', [productId]);
        for (const r of ss.rows || []) sizeStock[String(r.size).toUpperCase()] = Number(r.stock || 0);
      } catch(_) {}
      res.render("admin/editProducts", { product, discounts: all.rows, productDiscountIds, sizeStock });
    } catch (e) {
      // if discounts table missing, still render page
      res.render("admin/editProducts", { product, discounts: [], productDiscountIds: new Set(), sizeStock: {} });
    }
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
  // parse per-product promo fields (optional)
  const promo_active = (String(req.body.promo_active || '').toLowerCase() === 'on') || String(req.body.promo_active).toLowerCase() === 'true';
  let promo_percent = Number(req.body.promo_percent || 0);
  if (!Number.isFinite(promo_percent) || promo_percent < 0) promo_percent = 0;
  if (promo_percent > 100) promo_percent = 100;
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
        `UPDATE products SET name=$1, price=$2, category=$3, image_url=$4, image_url_2=$5, image_url_3=$6, image_url_4=$7, sizes=$8, colors=$9, promo_active=$10, promo_percent=$11 WHERE id=$12`,
        [name, priceInt, category, img0, img1, img2, img3, sizesCsv, colorsCsv, promo_active, promo_percent, productId]
      );
    } else {
      await db.query(
        `UPDATE products SET name=$1, price=$2, category=$3, sizes=$4, colors=$5, promo_active=$6, promo_percent=$7 WHERE id=$8`,
        [name, priceInt, category, sizesCsv, colorsCsv, promo_active, promo_percent, productId]
      );
    }

    // Update product-discount mapping
    try {
      await ensureDiscountsTable();
      let ids = req.body['discount_ids[]'] || req.body.discount_ids || [];
      if (!Array.isArray(ids)) ids = [ids];
      const parsed = ids.map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
      // clear existing
      await db.query('DELETE FROM discount_products WHERE product_id = $1', [productId]);
      // insert selected
      for (const did of parsed) {
        await db.query('INSERT INTO discount_products (discount_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [did, productId]);
      }
    } catch (e) {
      console.warn('Updating discount scope failed:', e.message);
    }

    // Upsert per-variant stock if provided: distribute size stock across all current colors
    try {
      const sizeStock = req.body['size_stock'] || {};
      const colorsList = (product && product.colors) ? String(product.colors).split(',').map(s=>s.trim()).filter(Boolean) : [];
      const allowedSizes = new Set(['S','M','L','XL']);
      if (sizeStock && typeof sizeStock === 'object') {
        for (const [sz, val] of Object.entries(sizeStock)) {
          const v = Math.max(0, parseInt(val));
          if (!Number.isNaN(v)) {
            const sizeUC = String(sz).toUpperCase();
            if (!allowedSizes.has(sizeUC)) continue; // respect CHECK constraint in schema
            if (colorsList.length) {
              for (const col of colorsList) {
                const colorLC = String(col).toLowerCase();
                const upd = await db.query(
                  `UPDATE product_variants SET stock = $4 WHERE product_id = $1 AND LOWER(color) = LOWER($2) AND UPPER(size) = UPPER($3)`,
                  [productId, colorLC, sizeUC, v]
                );
                if ((upd.rowCount || 0) === 0) {
                  await db.query(
                    `INSERT INTO product_variants (product_id, color, size, stock) VALUES ($1, $2, $3, $4)`,
                    [productId, colorLC, sizeUC, v]
                  );
                }
              }
            }
          }
        }
      }
    } catch(_) { /* ignore if table missing */ }

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
      SELECT p.id, p.name, p.price,
             COALESCE(ps.total_stock, 0) AS stock
      FROM products p
      LEFT JOIN (
        SELECT product_id, SUM(stock) AS total_stock
        FROM product_variants
        GROUP BY product_id
      ) ps ON ps.product_id = p.id
      ORDER BY p.id ASC
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

// ================== ADMIN DISCOUNTS ==================
router.get('/admin/discounts', requireAdmin, async (req, res) => {
  try {
    await ensureDiscountsTable();
    const { rows } = await db.query('SELECT * FROM discounts ORDER BY id DESC');
    res.render('admin/discounts', { user: req.session.user, discounts: rows });
  } catch (err) {
    console.error('Error rendering discounts page:', err);
    res.status(500).send('Server Error');
  }
});

// Create a new discount
router.post('/admin/discounts', requireAdmin, async (req, res) => {
  try {
    await ensureDiscountsTable();
    let { code, type, value, start_date, end_date, active, min_order, max_uses } = req.body;
    code = String(code || '').trim();
    type = String(type || '').trim().toLowerCase();
    value = Number(value);
    min_order = (min_order === '' || min_order === undefined) ? 0 : Number(min_order);
    max_uses = (max_uses === '' || max_uses === undefined) ? null : Number(max_uses);
    active = String(active || 'true') === 'true' || String(active) === 'on';
    const start = start_date ? new Date(start_date) : null;
    const end = end_date ? new Date(end_date) : null;

    if (!code || !/^[A-Za-z0-9_-]{3,30}$/.test(code)) {
    await ensureAuditLogsTable();
      return res.status(400).send('Invalid code. Use 3-30 alphanumeric characters, dash or underscore.');
    }
    if (!['percent','fixed'].includes(type)) {
      return res.status(400).send('Invalid type.');
    }
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).send('Invalid value.');
    }
    if (type === 'percent' && value > 100) value = 100;
    if (!Number.isFinite(min_order) || min_order < 0) min_order = 0;
    if (max_uses !== null && (!Number.isInteger(max_uses) || max_uses < 1)) max_uses = null;

    await db.query(
      `INSERT INTO discounts (code, type, value, start_date, end_date, active, min_order, max_uses)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [code.toUpperCase(), type, value, start, end, active, min_order, max_uses]
    );
    try {
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'announcement.create', JSON.stringify({ title, placement, active: isActive })]);
    } catch(_) {}
    res.redirect('/admin/discounts');
  } catch (err) {
    console.error('Error creating discount:', err);
    res.status(500).send('Server Error');
  }
});

// Toggle active flag
router.post('/admin/discounts/:id/toggle', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid id');
  try {
    await db.query('UPDATE announcements SET active = NOT active WHERE id = $1', [id]);
    try {
      await ensureAuditLogsTable();
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'announcement.toggle', JSON.stringify({ id })]);
    } catch(_) {}
    // flip active
    await db.query('UPDATE discounts SET active = NOT active WHERE id = $1', [id]);
    res.redirect('/admin/discounts');
  } catch (err) {
    console.error('Error toggling discount:', err);
    res.status(500).send('Server Error');
  }
});

// Delete a discount
router.post('/admin/discounts/:id/delete', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
    await db.query('DELETE FROM announcements WHERE id = $1', [id]);
    try {
      await ensureAuditLogsTable();
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'announcement.delete', JSON.stringify({ id })]);
    } catch(_) {}
  try {
    await ensureDiscountsTable();
    await db.query('DELETE FROM discounts WHERE id = $1', [id]);
    res.redirect('/admin/discounts');
  } catch (err) {
    console.error('Error deleting discount:', err);
    res.status(500).send('Server Error');
  }
});

// ================== ADMIN ANNOUNCEMENTS ==================
router.get('/admin/announcements', requireAdmin, async (req, res) => {
  try {
    await ensureAnnouncementsTable();
    const { rows } = await db.query('SELECT id, title, body, active, created_at, link_url, button_text, image_url, coupon_code, placement FROM announcements ORDER BY created_at DESC');
    res.render('admin/announcements', { user: req.session.user, items: rows });
  } catch (err) {
    console.error('Error rendering announcements page:', err);
    res.status(500).send('Server Error');
  }
});

router.post('/admin/announcements', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    await ensureAnnouncementsTable();
    let { title, body, active, link_url, button_text, image_url, coupon_code, placement } = req.body || {};
    title = String(title || '').trim();
    body = String(body || '').trim();
    const isActive = String(active || 'true') === 'true' || String(active) === 'on';
    placement = String(placement || 'modal').toLowerCase();
    if (!title) return res.status(400).send('Title is required');
    // If a file was uploaded, prefer it over the provided image_url
    try {
      if (req.file && req.file.filename) {
        image_url = `/uploads/${req.file.filename}`;
      }
    } catch(_) {}
    await db.query(
      'INSERT INTO announcements (title, body, active, link_url, button_text, image_url, coupon_code, placement) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [title, body, isActive, (link_url||null), (button_text||null), (image_url||null), (coupon_code||null), placement]
    );
    res.redirect('/admin/announcements');
  } catch (err) {
    console.error('Error creating announcement:', err);
    res.status(500).send('Server Error');
  }
});

router.post('/admin/announcements/:id/toggle', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid id');
  try {
    await ensureAnnouncementsTable();
    await db.query('UPDATE announcements SET active = NOT active WHERE id = $1', [id]);
    res.redirect('/admin/announcements');
  } catch (err) {
    console.error('Error toggling announcement:', err);
    res.status(500).send('Server Error');
  }
});

router.post('/admin/announcements/:id/delete', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid id');
  try {

// Edit announcement (form)
router.get('/admin/announcements/:id/edit', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid id');
  try {
    await ensureAnnouncementsTable();
    const { rows } = await db.query('SELECT id, title, body, active, link_url, button_text, image_url, coupon_code, placement FROM announcements WHERE id = $1', [id]);
    if (!rows || !rows[0]) return res.status(404).send('Announcement not found');
    res.render('admin/announcement-edit', { item: rows[0] });
  } catch (err) {
    console.error('Error loading announcement for edit:', err);
    res.status(500).send('Server Error');
  }
});

// Edit announcement (submit)
router.post('/admin/announcements/:id/edit', requireAdmin, upload.single('image'), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid id');
  try {
    await ensureAnnouncementsTable();
    // Load existing to preserve image if not changed
    const existing = await db.query('SELECT image_url FROM announcements WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).send('Announcement not found');
    const currentImage = existing.rows[0].image_url || null;

    let { title, body, active, link_url, button_text, image_url, coupon_code, placement } = req.body || {};
    title = String(title || '').trim();
    body = String(body || '').trim();
    const isActive = String(active || 'true') === 'true' || String(active) === 'on';
    placement = String(placement || 'modal').toLowerCase();
    if (!title) return res.status(400).send('Title is required');

    // File upload wins over provided URL
    try {
      if (req.file && req.file.filename) {
        image_url = `/uploads/${req.file.filename}`;
      }
    } catch(_) {}
    const finalImage = (image_url && image_url.trim()) ? image_url.trim() : currentImage;

    await db.query(
      `UPDATE announcements
          SET title=$1, body=$2, active=$3, link_url=$4, button_text=$5, image_url=$6, coupon_code=$7, placement=$8
        WHERE id=$9`,
      [title, body, isActive, (link_url||null), (button_text||null), (finalImage||null), (coupon_code||null), placement, id]
    );

    try {
      await ensureAuditLogsTable();
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'announcement.edit', JSON.stringify({ id, title, placement, active: isActive })]);
    } catch(_) {}

    res.redirect('/admin/announcements');
  } catch (err) {
    console.error('Error updating announcement:', err);
    res.status(500).send('Server Error');
  }
});
    await ensureAnnouncementsTable();
    await db.query('DELETE FROM announcements WHERE id = $1', [id]);
    res.redirect('/admin/announcements');
  } catch (err) {
    console.error('Error deleting announcement:', err);
    res.status(500).send('Server Error');
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

// ================== ADMIN ORDERS LIST ==================
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const range = String(req.query.range || 'this-month');
    let dateCondition = '';
    if (range === 'this-week') {
      dateCondition = `WHERE o.order_date >= date_trunc('week', current_date)`;
    } else if (range === 'last-month') {
      dateCondition = `WHERE o.order_date >= date_trunc('month', current_date) - interval '1 month' AND o.order_date < date_trunc('month', current_date)`;
    } else if (range === 'this-month') {
      dateCondition = `WHERE o.order_date >= date_trunc('month', current_date)`;
    } else {
      // all time: no dateCondition
      dateCondition = '';
    }

    const sql = `
      SELECT o.id,
             (c.first_name || ' ' || c.last_name) AS customer_name,
             c.email AS customer_email,
             c.profile_image AS customer_image,
             o.order_date,
             o.status,
             COALESCE(SUM(oi.quantity * oi.price), 0) AS total_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${dateCondition}
      GROUP BY o.id, c.first_name, c.last_name, c.email, c.profile_image, o.order_date, o.status
      ORDER BY o.order_date DESC`;

    const result = await db.query(sql);

    const orders = result.rows.map(r => ({
      ...r,
      total_amount: Number(r.total_amount || 0)
    }));

    res.render('admin/orders', { orders, range });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).send('Server Error');
  }
});

// ================== DELETE ORDER ==================
router.delete('/admin/orders/:id', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) return res.status(400).send('Invalid order id');
  try {
    // remove order items first to satisfy FK constraints
    await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
    res.redirect('/orders');
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).send('Server Error');
  }
});

// Fallback: POST delete (no method-override required)
router.post('/admin/orders/:id/delete', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) return res.status(400).send('Invalid order id');
  try {
    await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
    res.redirect('/orders');
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).send('Server Error');
  }
});

// ================== VIEW ORDER ==================
router.get('/admin/orders/:id', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) return res.status(400).send('Invalid order id');
  try {
    const orderResult = await db.query(`
      SELECT o.id,
             o.order_date,
             o.status,
             o.estimated_delivery,
             o.estimated_delivery_start,
             o.estimated_delivery_end,
             (c.first_name || ' ' || c.last_name) AS customer_name,
             c.email AS customer_email,
             c.profile_image AS customer_image,
             -- shipping/contact fields captured on the order at checkout time
             o.first_name AS ship_first_name,
             o.last_name AS ship_last_name,
             o.address AS ship_address,
             o.city AS ship_city,
             o.province AS ship_province,
             o.zipcode AS ship_zipcode,
             o.phone AS ship_phone,
             o.email AS ship_email,
             o.payment_method,
             o.payment_completed,
             o.paypal_order_id,
             -- saved rollups (if available)
             COALESCE(o.subtotal, 0) AS saved_subtotal,
             COALESCE(o.tax, 0) AS saved_tax,
             COALESCE(o.total, 0) AS saved_total,
             -- computed rollup from items as fallback
             COALESCE(SUM(oi.quantity * oi.price), 0) AS total_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id, o.order_date, o.status, c.first_name, c.last_name, c.email, c.profile_image
    `, [orderId]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).send('Order not found');

    const itemsResult = await db.query(`
      SELECT oi.product_id,
             COALESCE(oi.product_name, p.name) AS product_name,
             COALESCE(oi.image_url, p.image_url) AS image_url,
             oi.quantity, oi.price,
             (oi.quantity * oi.price) AS subtotal
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
    `, [orderId]);

    const items = itemsResult.rows.map(x => ({
      ...x,
      quantity: Number(x.quantity || 0),
      price: Number(x.price || 0),
      subtotal: Number(x.subtotal || 0)
    }));

    order.total_amount = Number(order.total_amount || 0);
    // Prefer saved rollups if present; otherwise fallback to computed amount
    const subtotal = Number(order.saved_subtotal || 0);
    const tax = Number(order.saved_tax || 0);
    const total = Number(order.saved_total || order.total_amount || 0);
    const shipping = Math.max(total - subtotal - tax, 0);

    res.render('admin/orderView', {
      order: {
        ...order,
        subtotal,
        tax,
        total,
        shipping
      },
      items,
      store: storeConfig
    });
  } catch (err) {
    console.error('Error fetching order details:', err);
    res.status(500).send('Server Error');
  }
});

// ================== EDIT ORDER STATUS ==================
router.get('/admin/orders/:id/edit', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) return res.status(400).send('Invalid order id');
  try {
  const result = await db.query('SELECT id, status, order_date, estimated_delivery, estimated_delivery_start, estimated_delivery_end FROM orders WHERE id = $1', [orderId]);
    const order = result.rows[0];
    if (!order) return res.status(404).send('Order not found');
    res.render('admin/orderEdit', { order });
  } catch (err) {
    console.error('Error loading order for edit:', err);
    res.status(500).send('Server Error');
  }
});

router.post('/admin/orders/:id/edit', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  const { status, delivery_line, estimated_delivery_date, estimated_delivery_start_date, estimated_delivery_end_date } = req.body; // delivery_line optional/back-compat
  if (isNaN(orderId)) return res.status(400).send('Invalid order id');
  try {
    // Prefer delivery_line only if sent by older forms; otherwise use status
    const raw = (delivery_line && String(delivery_line).trim()) ? String(delivery_line).trim() : String(status || '').trim();
    if (!raw) return res.status(400).send('Missing status');
    // Parse optional ETA range (YYYY-MM-DD). Also support legacy single date.
    function parseDate(val){
      const s = String(val || '').trim();
      if (!s) return null;
      const dt = new Date(s + 'T00:00:00Z');
      return isNaN(dt.getTime()) ? null : dt;
    }
    const etaStart = parseDate(estimated_delivery_start_date);
    const etaEnd = parseDate(estimated_delivery_end_date);
    const etaSingle = parseDate(estimated_delivery_date);

    if (etaStart || etaEnd || etaSingle !== null || estimated_delivery_start_date === '' || estimated_delivery_end_date === '' || estimated_delivery_date === ''){
      // Determine values to set
      let startVal = etaStart;
      let endVal = etaEnd;
      // If only legacy single provided, set both to that date
      if (!startVal && !endVal && etaSingle) { startVal = etaSingle; endVal = etaSingle; }
      // If explicit clear (empty strings), clear range and legacy column
      if (estimated_delivery_start_date === '' && estimated_delivery_end_date === '') {
        await db.query('UPDATE orders SET status = $1, estimated_delivery = NULL, estimated_delivery_start = NULL, estimated_delivery_end = NULL WHERE id = $2', [raw, orderId]);
      } else {
        await db.query('UPDATE orders SET status = $1, estimated_delivery = $2, estimated_delivery_start = $3, estimated_delivery_end = $4 WHERE id = $5', [raw, endVal || startVal || null, startVal, endVal, orderId]);
      }
    } else {
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', [raw, orderId]);
    }

    // Best-effort: set timestamp columns when moving into certain states, if schema supports them
    try {
      const statusLc = raw.toLowerCase();
      const colsRes = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = ANY($1)`,
        [["paid_at", "shipped_at", "out_for_delivery_at", "delivered_at"]]
      );
      const have = new Set((colsRes.rows || []).map(r => r.column_name));
      const now = new Date();
      if (have.has('paid_at') && (/paid|payment/.test(statusLc))) {
        await db.query('UPDATE orders SET paid_at = COALESCE(paid_at, $1) WHERE id = $2', [now, orderId]);
      }
      if (have.has('shipped_at') && /ship/.test(statusLc)) {
        await db.query('UPDATE orders SET shipped_at = COALESCE(shipped_at, $1) WHERE id = $2', [now, orderId]);
      }
      if (have.has('out_for_delivery_at') && (/out|en route|courier/.test(statusLc))) {
        await db.query('UPDATE orders SET out_for_delivery_at = COALESCE(out_for_delivery_at, $1) WHERE id = $2', [now, orderId]);
      }
      if (have.has('delivered_at') && /deliver|complete/.test(statusLc)) {
        await db.query('UPDATE orders SET delivered_at = COALESCE(delivered_at, $1) WHERE id = $2', [now, orderId]);
      }
    } catch (e) {
      // ignore if columns absent
    }

    // Best-effort: notify the customer about the order update
    try {
      // Load customer id for this order
      const ownerRes = await db.query('SELECT customer_id FROM orders WHERE id = $1', [orderId]);
      const customerId = ownerRes.rows && ownerRes.rows[0] ? Number(ownerRes.rows[0].customer_id) : null;
      if (customerId) {
        // Ensure notifications table exists
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
        const normalized = String(raw).trim();
        const title = `Order update: ${normalized}`;
        // Build a friendly ETA text if available
        let etaText = '';
        const s = String(estimated_delivery_start_date || '').trim();
        const e = String(estimated_delivery_end_date || '').trim();
        const single = String(estimated_delivery_date || '').trim();
        if (s && e) etaText = ` Estimated delivery: ${s} - ${e}.`;
        else if (single) etaText = ` Estimated delivery: ${single}.`;
        const body = `Your order #${orderId} status is now "${normalized}".${etaText}`;
        const link = `/orders/${orderId}/track`;
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
          [customerId, title, body, link]
        );
      }
    } catch (e) {
      // Non-fatal if notification cannot be recorded
      console.warn('Admin order update notification skipped:', e.message);
    }
    // Audit log for order status update
    try {
      await ensureAuditLogsTable();
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'order.update', JSON.stringify({ orderId, status: (delivery_line && String(delivery_line).trim()) ? String(delivery_line).trim() : String(status||'').trim() })]);
    } catch(_) {}
    res.redirect(`/admin/orders/${orderId}`);
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).send('Server Error');
  }
});

// ================== ADMIN AUDIT LOGS ==================
router.get('/admin/audit-logs', requireAdmin, async (req, res) => {
  try {
    await ensureAuditLogsTable();
    const { rows } = await db.query(
      `SELECT al.id, al.user_id, al.action, al.meta, al.created_at,
              COALESCE(c.first_name || ' ' || c.last_name, 'Admin') AS user_name
         FROM audit_logs al
         LEFT JOIN customers c ON al.user_id = c.id
        ORDER BY al.created_at DESC
        LIMIT 200`);
    res.render('admin/audit-logs', { items: rows });
  } catch (err) {
    console.error('Error rendering audit logs:', err);
    res.status(500).send('Server Error');
  }
});

// ================== ADMIN CMS (placeholder) ==================
router.get('/admin/cms', requireAdmin, async (req, res) => {
  try {
    await ensureCmsTable();
    // Ensure default pages exist
    const defaults = [
      { slug: 'homepage', title: 'Homepage', data: { hero_title: 'Rise beyond limits', hero_subtitle: 'Because limits are meant to be broken.', cta_text: 'Shop the Collection', cta_href: '/products', hero_image_url: '/image/banner.png' } },
      { slug: 'footer', title: 'Footer', data: { contact_email: 'support@example.com', phone: '', address: '' } },
      { slug: 'about', title: 'About Us', data: { about_html: '<p>Tell your brand story here.</p>' } }
    ];
    for (const d of defaults) {
      await db.query(`INSERT INTO cms_pages (slug, title, data) VALUES ($1,$2,$3)
                      ON CONFLICT (slug) DO NOTHING`, [d.slug, d.title, d.data]);
    }
    const { rows } = await db.query('SELECT slug, title, data, updated_at FROM cms_pages ORDER BY slug ASC');
    res.render('admin/cms', { user: req.session.user, pages: rows });
  } catch (err) {
    console.error('Error rendering CMS page:', err);
    res.status(500).send('Server Error');
  }
});

router.get('/admin/cms/:slug/edit', requireAdmin, async (req, res) => {
  try {
    await ensureCmsTable();
    const slug = String(req.params.slug || '').trim();
    const { rows } = await db.query('SELECT slug, title, data FROM cms_pages WHERE slug = $1', [slug]);
    if (!rows || !rows[0]) return res.status(404).send('CMS page not found');
    res.render('admin/cms-edit', { page: rows[0] });
  } catch (err) {
    console.error('Error rendering CMS edit page:', err);
    res.status(500).send('Server Error');
  }
});

router.post('/admin/cms/:slug/edit', requireAdmin, upload.any(), async (req, res) => {
  try {
    await ensureCmsTable();
    const slug = String(req.params.slug || '').trim();
    // Load existing data to preserve fields not provided
    let existing = null;
    try {
      const ex = await db.query('SELECT data FROM cms_pages WHERE slug = $1', [slug]);
      existing = ex.rows && ex.rows[0] ? (ex.rows[0].data || {}) : {};
    } catch(_) { existing = {}; }
    // Build data object depending on slug (simple mapping)
    let data = {};
    if (slug === 'homepage') {
      let hero_image_url = existing.hero_image_url || '/image/banner.png';
      try {
        // multer.any() places uploaded files in req.files array
        const heroFile = (req.files || []).find(f => f.fieldname === 'hero_image');
        if (heroFile && heroFile.filename) {
          hero_image_url = `/uploads/${heroFile.filename}`;
        }
        console.log('[CMS] received files:', (req.files || []).map(f=>({ field: f.fieldname, filename: f.filename })));
      } catch(_) {}
      data = {
        hero_title: String(req.body.hero_title || existing.hero_title || ''),
        hero_subtitle: String(req.body.hero_subtitle || existing.hero_subtitle || ''),
        cta_text: String(req.body.cta_text || existing.cta_text || ''),
        cta_href: String(req.body.cta_href || existing.cta_href || ''),
        hero_image_url
      };
      // Debug: log what will be saved to DB
      console.log('[CMS] saving homepage data:', data);
    } else if (slug === 'footer') {
      data = {
        contact_email: String(req.body.contact_email || existing.contact_email || ''),
        phone: String(req.body.phone || existing.phone || ''),
        address: String(req.body.address || existing.address || '')
      };
    } else if (slug === 'about') {
      // Block-based About Us CMS
      // Parse features and team from JSON or arrays
      let features = [];
      let key_features = [];
      let team = [];
      // features and key_features: accept either JSON strings or array fields
      try { features = JSON.parse(req.body.features || '[]'); } catch(_) { features = Array.isArray(req.body.features) ? req.body.features : (req.body.features ? [req.body.features] : []); }
      try { key_features = JSON.parse(req.body.key_features || '[]'); } catch(_) { key_features = Array.isArray(req.body.key_features) ? req.body.key_features : (req.body.key_features ? [req.body.key_features] : []); }
      // team: be robust to different shapes (JSON string, array, or object with numeric keys)
      const rawTeam = req.body.team;
      if (typeof rawTeam === 'string') {
        try { team = JSON.parse(rawTeam); } catch(_) { team = []; }
      } else if (Array.isArray(rawTeam)) {
        team = rawTeam;
      } else if (rawTeam && typeof rawTeam === 'object') {
        // convert object keyed by numeric indices to array
        const keys = Object.keys(rawTeam).sort(function(a,b){ return Number(a) - Number(b); });
        team = keys.map(k => rawTeam[k]);
      } else {
        team = [];
      }
      // about image: accept an uploaded file named 'about_image'
      let about_image_url = existing.about_image_url || '';
      try {
        const aboutFile = (req.files || []).find(f => f.fieldname === 'about_image');
        if (aboutFile && aboutFile.filename) {
          about_image_url = `/uploads/${aboutFile.filename}`;
        }
      } catch(_) {}

      // Map uploaded per-team images (field names like team_image_0) onto the parsed team array
      try {
        (req.files || []).forEach(f => {
          if (!f.fieldname) return;
          const m = f.fieldname.match(/^team_image_(\d+)$/);
          if (m) {
            const idx = Number(m[1]);
            if (!isNaN(idx)) {
              team[idx] = team[idx] || {};
              team[idx].image_url = `/uploads/${f.filename}`;
            }
          }
        });
      } catch(_) {}

      // Merge submitted team entries with existing ones so unchanged fields (like image_url)
      // are preserved when admin edits only name or role.
      try {
        const existingTeam = (existing && existing.team) ? existing.team : [];
        const merged = [];
        const maxLen = Math.max(existingTeam.length, team.length);
        for (let i = 0; i < maxLen; i++) {
          const sub = team[i] || {};
          const ex = existingTeam[i] || {};
          // Normalize fields
          const name = (typeof sub.name === 'string' && sub.name.trim() !== '') ? sub.name.trim() : (ex.name || '');
          const role = (typeof sub.role === 'string' && sub.role.trim() !== '') ? sub.role.trim() : (ex.role || '');
          // If submitted image_url is present and non-empty, use it; otherwise keep existing
          const image_url = (sub && typeof sub.image_url === 'string' && sub.image_url.trim() !== '') ? sub.image_url.trim() : (ex.image_url || '');
          merged.push({ name, role, image_url });
        }
        team = merged;
      } catch (e) {
        // fallback: leave team as-is
      }
      data = {
        about_title: String(req.body.about_title || existing.about_title || ''),
        about_subtitle: String(req.body.about_subtitle || existing.about_subtitle || ''),
        about_body: String(req.body.about_body || existing.about_body || ''),
        about_image_url,
        features,
        why_title: String(req.body.why_title || existing.why_title || ''),
        why_body: String(req.body.why_body || existing.why_body || ''),
        key_features,
        team_title: String(req.body.team_title || existing.team_title || ''),
        team_subtitle: String(req.body.team_subtitle || existing.team_subtitle || ''),
        team
      };
    } else {
      // Generic: accept all form fields into data
      data = { ...existing, ...req.body };
    }

    await db.query('UPDATE cms_pages SET data = $2, updated_at = NOW() WHERE slug = $1', [slug, data]);
    try {
      await ensureAuditLogsTable();
      const uid = req.session && req.session.user ? req.session.user.id : null;
      await db.query('INSERT INTO audit_logs (user_id, action, meta) VALUES ($1,$2,$3)', [uid, 'cms.edit', JSON.stringify({ slug })]);
    } catch(_) {}
    res.redirect('/admin/cms');
  } catch (err) {
    console.error('Error saving CMS edit:', err);
    res.status(500).send('Server Error');
  }
});

export default router;