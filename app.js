import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import db from "./src/database/db.js";
import loginRoutes from "./src/Routes/loginRoutes.js";
import authRoutes from "./src/Routes/authRoutes.js";
import session from "express-session";
import passport from "passport"; 
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import googleAuthRoutes from "./src/Routes/googleauthRoutes.js";
import { requireLogin, requireAdmin } from "./src/Middleware/authMiddleware.js";
import { cartCountMiddleware } from "./src/Middleware/cartMiddleware.js";
import productRoutes from "./src/Routes/productRoutes.js";
import cartRoutes from "./src/Routes/cartRoutes.js";
import checkoutRoutes from "./src/Routes/checkoutRoutes.js";
import adminRoutes from "./src/Routes/adminRoutes.js";
import paymentRoutes from "./src/Routes/paymentRoutes.js";
import accountRoutes from "./src/Routes/accountRoutes.js";
import paypalRoutes from "./src/Routes/paypalRoutes.js";
import searchRoutes from "./src/Routes/searchRoutes.js";
import addressRoutes from "./src/Routes/addressRoutes.js";
import orderRoutes from "./src/Routes/orderRoutes.js";
import trackingRoutes from "./src/Routes/trackingRoutes.js";
import notificationsRoutes from "./src/Routes/notificationsRoutes.js";


dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();


// --------------------
// Session middleware
// --------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_secret", // use .env secret
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // true if using HTTPS
  })
);

// --------------------
// Passport initialization
// --------------------
app.use(passport.initialize());
app.use(passport.session());

// Serialize / deserialize
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query("SELECT * FROM customers WHERE id = $1", [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err, null);
  }
});


// --------------------
// Google OAuth Strategy
// --------------------
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const result = await db.query(
        "SELECT * FROM customers WHERE google_id = $1",
        [profile.id]
      );

      let user;
      if (result.rows.length > 0) {
        user = result.rows[0];
      } else {
        const insert = await db.query(
          "INSERT INTO customers (google_id, email, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING *",
          [profile.id, profile.emails[0].value, profile.name.givenName, profile.name.familyName]
        );
        user = insert.rows[0];
      }

      // ✅ Return the DB user, not Google profile
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));



// --------------------
// Database connection
// --------------------
db.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch((err) => console.error("❌ Database connection error:", err.stack));

// Ensure product promo columns exist (auto-apply per-product discounts)
async function ensureProductPromoColumns() {
  try {
    await db.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_active BOOLEAN NOT NULL DEFAULT false;");
    await db.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_percent NUMERIC NOT NULL DEFAULT 0;");
  } catch (e) {
    console.warn('Promo columns ensure failed (may already exist or insufficient privileges):', e.message);
  }
}
// Normalize legacy order statuses ('order processed' -> 'Processing')
async function normalizeOldOrderStatuses() {
  try {
    await db.query("UPDATE orders SET status = 'Processing' WHERE LOWER(TRIM(status)) = 'order processed';");
  } catch (e) {
    console.warn('Order status normalization skipped:', e.message);
  }
}
// Ensure estimated delivery column exists on orders
async function ensureEstimatedDeliveryColumn() {
  try {
    await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ NULL;");
  } catch (e) {
    console.warn('Estimated delivery column ensure skipped:', e.message);
  }
}
// Ensure estimated delivery range columns exist on orders
async function ensureEstimatedDeliveryRangeColumns() {
  try {
    await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_start TIMESTAMPTZ NULL;");
    await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_end TIMESTAMPTZ NULL;");
  } catch (e) {
    console.warn('Estimated delivery range columns ensure skipped:', e.message);
  }
}
// Fire-and-forget ensure after DB connection established
(async () => {
  try { await ensureProductPromoColumns(); } catch(_){}
  try { await normalizeOldOrderStatuses(); } catch(_){}
  try { await ensureEstimatedDeliveryColumn(); } catch(_){}
  try { await ensureEstimatedDeliveryRangeColumns(); } catch(_){}
  // Using external table product_sizes provided by your schema; no auto-ensure here
})();

// --------------------
// View engine & static files
// --------------------
app.set("views", join(__dirname, "src/views"));
app.set("view engine", "ejs");
// Serve static files. Prefer src/public (if used), but also fall back to the repo-level
// public/ directory so assets like `/css/homepage.css` and `/image/*` are served.
app.use(express.static(join(__dirname, "src/public")));
app.use(express.static(join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Expose a transient notice (flash-like) to templates and clear it from session
app.use((req, res, next) => {
  if (req.session && req.session.notice) {
    res.locals.notice = req.session.notice;
    delete req.session.notice;
  } else {
    res.locals.notice = null;
  }
  next();
});

// Load CMS footer data into res.locals for templates (best-effort per-request)
app.use(async (req, res, next) => {
  try {
    // ensure cms_pages table exists (no-op if already present)
    await db.query(`CREATE TABLE IF NOT EXISTS cms_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const r = await db.query("SELECT data FROM cms_pages WHERE slug = 'footer'");
    res.locals.cmsFooter = (r.rows && r.rows[0] && r.rows[0].data) ? r.rows[0].data : null;
  } catch (e) {
    res.locals.cmsFooter = null;
  }
  next();
});

// --------------------
// Routes
// --------------------
app.use("/", authRoutes);
app.use("/", loginRoutes);
app.use(cartCountMiddleware);
app.use(productRoutes);
app.use("/cart", cartRoutes);
app.use("/checkout", checkoutRoutes);
app.use("/", adminRoutes);
app.use("/", paymentRoutes);
app.use("/accountsettings", accountRoutes);
app.use("/api/paypal", paypalRoutes);
app.use("/", googleAuthRoutes);
app.use("/", searchRoutes);
app.use("/api", addressRoutes);
app.use("/", orderRoutes);
app.use("/api", trackingRoutes);
app.use("/", notificationsRoutes);

// --------------------
// Page routes
// --------------------
app.get("/", async (req, res) => {
  try {
    // get top 4 selling products to show in featured section
    const top = await db.query(`
      SELECT p.id, p.name, p.price, p.category,
        COALESCE(p.image_url, p.image_url_2, p.image_url_3, p.image_url_4) AS image,
        COALESCE(SUM(oi.quantity),0) AS total_sold
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 4
    `);
    const featuredProducts = top.rows.map(r => ({
      ...r,
      image: r.image || '/image/fp1.png',
      price: Number(r.price || 0).toFixed(2),
      total_sold: Number(r.total_sold || 0)
    }));

    // Announcements removed from public site (server no longer fetches/shows them)

    // CMS: homepage content (best-effort)
    let cmsHome = null;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS cms_pages (
          slug TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const def = {
        slug: 'homepage',
        title: 'Homepage',
        data: { hero_title: 'Rise beyond limits', hero_subtitle: 'Because limits are meant to be broken.', cta_text: 'Shop the Collection', cta_href: '/products', hero_image_url: '/image/banner.png' }
      };
      await db.query(`INSERT INTO cms_pages (slug, title, data) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`, [def.slug, def.title, def.data]);
      const row = await db.query(`SELECT data FROM cms_pages WHERE slug = 'homepage'`);
      cmsHome = (row.rows && row.rows[0] && row.rows[0].data) ? row.rows[0].data : null;
    } catch (_) { cmsHome = null; }

  res.render("customer/homepage", { user: req.session.user, featuredProducts, cmsHome });
  } catch (err) {
    console.error('Error fetching featured products:', err);
    res.render("customer/homepage", { user: req.session.user, featuredProducts: [], announcements: [], cmsHome: null });
  }
});

app.get("/homepage", async (req, res) => {
  // mirror root behavior
  try {
    const top = await db.query(`
      SELECT p.id, p.name, p.price, p.category,
        COALESCE(p.image_url, p.image_url_2, p.image_url_3, p.image_url_4) AS image,
        COALESCE(SUM(oi.quantity),0) AS total_sold
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 4
    `);
    const featuredProducts = top.rows.map(r => ({
      ...r,
      image: r.image || '/image/fp1.png',
      price: Number(r.price || 0).toFixed(2),
      total_sold: Number(r.total_sold || 0)
    }));

    // Announcements removed from public site (server no longer fetches/shows them)

    // CMS: homepage content (best-effort)
    let cmsHome = null;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS cms_pages (
          slug TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const row = await db.query(`SELECT data FROM cms_pages WHERE slug = 'homepage'`);
      cmsHome = (row.rows && row.rows[0] && row.rows[0].data) ? row.rows[0].data : null;
    } catch (_) { cmsHome = null; }

  res.render("customer/homepage", { user: req.session.user, featuredProducts, cmsHome });
  } catch (err) {
    console.error('Error fetching featured products:', err);
    res.render("customer/homepage", { user: req.session.user, featuredProducts: [], announcements: [], cmsHome: null });
  }
});

app.get("/admin", requireAdmin, (req, res) => {
  res.render("admin/admin", { user: req.session.user });
});

app.get("/login", (req, res) => {
  res.render("customer/login");
});

app.get("/help", (req, res) => {
  res.render("customer/help");
});

app.get("/aboutus", async (req, res) => {
  // CMS: about page content
  let cmsAbout = null;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cms_pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const row = await db.query(`SELECT data FROM cms_pages WHERE slug = 'about'`);
    cmsAbout = (row.rows && row.rows[0] && row.rows[0].data) ? row.rows[0].data : null;
  } catch (_) { cmsAbout = null; }
  res.render("customer/aboutus", { cmsAbout });
});

app.get("/products", (req, res) => {
  res.render("customer/products");
});

// --------------------
// Start server
// --------------------
const port = process.env.PORT || 3000; // fallback for local development
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});