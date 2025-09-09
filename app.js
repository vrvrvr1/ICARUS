import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import db from "./src/database/db.js";
import loginRoutes from "./src/Routes/loginRoutes.js"
import authRoutes from "./src/Routes/authRoutes.js";
import session from "express-session";
import { requireLogin, requireAdmin } from "./src/Middleware/authMiddleware.js";
import { cartCountMiddleware } from "./src/Middleware/cartMiddleware.js";
import productRoutes from "./src/Routes/productRoutes.js";
import cartRoutes from "./src/Routes/cartRoutes.js";
import checkoutRoutes from "./src/Routes/checkoutRoutes.js";
import adminRoutes from "./src/Routes/adminRoutes.js";
import paymentRoutes from "./src/Routes/paymentRoutes.js"


const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3000;

app.use(
  session({
    secret: "your_secret_key", // change to strong secret
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // set true if using HTTPS
  })
);

// Test DB connection
db.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ Database connection error:", err.stack));


// Set view engine and views folder
app.set("views", join(__dirname, "src/views"));
app.set("view engine", "ejs");

// Serve static files from public folder
app.use(express.static(join(__dirname, "src/public")));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/", authRoutes);
app.use("/", loginRoutes);
app.use(cartCountMiddleware);
app.use(productRoutes);
app.use("/cart", cartRoutes);
app.use("/checkout", checkoutRoutes);
app.use("/", adminRoutes);
app.use("/payment", paymentRoutes);


// Routes
app.get("/", (req, res) => {
  res.render("customer/homepage"); 
});
// homepage page route
app.get("/homepage", (req, res) => {
  res.render("customer/homepage", {user: req.session.user}); 
});
// admin dashboard
app.get("/admin", requireAdmin, (req, res) => {
  res.render("admin/admin", { user: req.session.user });
});
// Login page route
app.get("/login", (req, res) => {
  res.render("customer/login");
});
// Help page route
app.get("/help", (req, res) => {
  res.render("customer/help");
});
// Aboutus page route
app.get("/aboutus", (req, res) => {
  res.render("customer/aboutus");
});
// Product page route
app.get("/products", (req, res) => {
  res.render("customer/products");
});



app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
});



