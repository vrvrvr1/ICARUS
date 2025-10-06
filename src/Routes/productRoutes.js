import express from "express";
import db from "../database/db.js";

const router = express.Router();

// -------------------
// Product Filtering Route
// -------------------
router.get("/products/filter", async (req, res) => {
  try {
    const {
      minPrice = 0,
      maxPrice = 10000,
      minRating = 1,
      colors = "",
      sizes = ""
    } = req.query;

    let query = `SELECT * FROM products WHERE price BETWEEN $1 AND $2 AND rating >= $3`;
    const params = [minPrice, maxPrice, minRating];
    let idx = params.length;

    // Handle colors (stored as VARCHAR, comma-separated string)
    if (colors) {
      const colorArray = colors.split(",").map(c => c.trim());
      const colorConditions = colorArray
        .map((c, i) => `colors ILIKE $${idx + i + 1}`)
        .join(" OR ");
      query += ` AND (${colorConditions})`;
      params.push(...colorArray.map(c => `%${c}%`));
      idx = params.length;
    }

    // Handle sizes (if VARCHAR as well)
    if (sizes) {
      const sizeArray = sizes.split(",").map(s => s.trim());
      const sizeConditions = sizeArray
        .map((s, i) => `sizes ILIKE $${idx + i + 1}`)
        .join(" OR ");
      query += ` AND (${sizeConditions})`;
      params.push(...sizeArray.map(s => `%${s}%`));
      idx = params.length;
    }

    const result = await db.query(query, params);

    if (req.xhr || req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json(result.rows); // for AJAX
    }

    const currentCategory = req.query.category || null;
    res.render("customer/products", { products: result.rows, user: req.session.user, currentCategory });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error filtering products");
  }
});


// -------------------
// Get all products route
// -------------------
// Get all products route
router.get("/products", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products");
    let products = result.rows;

    if (req.session.user) {
      const wishlistRes = await db.query(
        "SELECT product_id FROM wishlist WHERE user_id = $1",
        [req.session.user.id]
      );
      const wishlistIds = wishlistRes.rows.map(r => r.product_id);

      // Add wishlisted flag
      products = products.map(p => ({
        ...p,
        wishlisted: wishlistIds.includes(p.id)
      }));
    }

  const currentCategory = req.query.category || null;
  res.render("customer/products", { products, user: req.session.user, currentCategory });
  } catch (err) {
    console.error("❌ Error fetching products:", err);
    res.status(500).send("Server error");
  }
});

// -------------------
// Get single product by ID
// -------------------
router.get("/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query("SELECT * FROM products WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).send("Product not found");
    }

    const product = result.rows[0];

    // Convert price to number
    product.price = Number(product.price);

    // Images array
    const images = [product.image_url, product.image_url_2, product.image_url_3, product.image_url_4].filter(img => img && img.trim() !== "");
    const safeImages = images.length > 0 ? images : ['/image/default.png'];

    // Colors and sizes
    const colors = product.colors ? product.colors.split(",").map(c => c.trim().toLowerCase()) : [];
    const sizes = product.sizes ? product.sizes.split(",").map(s => s.trim().toUpperCase()) : [];
    const allColors = ["black","red","blue","green"];
    const allSizes = ["S","M","L","XL"];

    // Rating
    product.rating = Math.min(Math.max(Number(product.rating) || 0, 0), 5);

    // Check if the user has this product in wishlist
    let userWishlisted = false;
    if (req.session.user) {
      const wishlistCheck = await db.query(
        "SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2",
        [req.session.user.id, id]
      );
      userWishlisted = wishlistCheck.rows.length > 0;
    }

    res.render("customer/product-showcase", {
      product,
      images: safeImages,
      colors,
      allColors,
      sizes,
      allSizes,
      user: req.session.user,
      userWishlisted,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


// -------------------
// Toggle Wishlist (Add/Remove)
// -------------------
router.post("/wishlist/toggle/:productId", async (req, res) => {
  const userId = req.session.user?.id;
  const productId = req.params.productId;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  try {
    const existing = await db.query(
      "SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2",
      [userId, productId]
    );

    if (existing.rows.length > 0) {
      // Remove from wishlist
      await db.query(
        "DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2",
        [userId, productId]
      );
      return res.json({ wishlisted: false, message: "Removed from wishlist" });
    } else {
      // Add to wishlist
      await db.query(
        "INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2)",
        [userId, productId]
      );
      return res.json({ wishlisted: true, message: "Added to wishlist" });
    }
  } catch (err) {
    console.error("❌ Wishlist error:", err);
    res.status(500).json({ error: "Server error" });
  }
});




export default router;
