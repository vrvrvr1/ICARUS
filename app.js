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
import passport from "passport"; // ✅ IMPORT passport here
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


dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

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
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback"
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

// --------------------
// View engine & static files
// --------------------
app.set("views", join(__dirname, "src/views"));
app.set("view engine", "ejs");
app.use(express.static(join(__dirname, "src/public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
app.use("/", googleAuthRoutes); // Google Auth routes under /api
app.use("/", searchRoutes);

// --------------------
// Page routes
// --------------------
app.get("/", (req, res) => {
  res.render("customer/homepage", { user: req.session.user });
});

app.get("/homepage", (req, res) => {
  res.render("customer/homepage", { user: req.session.user });
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

app.get("/aboutus", (req, res) => {
  res.render("customer/aboutus");
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
