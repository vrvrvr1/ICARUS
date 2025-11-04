import express from "express";
import db from "../database/db.js";

const router = express.Router();

// Simple auth guard for review submission
function ensureAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) {
    // redirect to login preserving return path
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }
  next();
}

// -------------------
// Product Filtering Route
// -------------------
router.get("/products/filter", async (req, res) => {
  try {
    const {
      minPrice = 0,
      maxPrice = 10000,
      minRating = 0,
      maxRating = 5,
      category = "",
      colors = "",
      sizes = "",
      search = ""
    } = req.query;

    // Base filters for price and rating
    let query = `SELECT p.* FROM products p WHERE p.price BETWEEN $1 AND $2 AND COALESCE(p.rating,0) BETWEEN $3 AND $4`;
    const params = [Number(minPrice), Number(maxPrice), Number(minRating), Number(maxRating)];
    let idx = params.length;

    // Optional: filter by search query if provided
    if (search && String(search).trim() !== "") {
      const searchTerm = `%${String(search).trim()}%`;
      query += ` AND (p.name ILIKE $${++idx} OR p.category ILIKE $${idx})`;
      params.push(searchTerm);
    }
    // Optional: filter by category if provided (and no search query)
    else if (category && String(category).trim() !== "") {
      query += ` AND p.category = $${++idx}`;
      params.push(String(category).trim());
    }

    // Normalize color/size arrays
    const colorArray = (colors ? String(colors).split(',').map(c => c.trim().toLowerCase()).filter(Boolean) : []);
    const sizeArray = (sizes ? String(sizes).split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []);

    // If colors/sizes provided, require existence of a matching variant with stock > 0
    if (colorArray.length > 0 || sizeArray.length > 0) {
      const hasColors = colorArray.length > 0;
      const hasSizes = sizeArray.length > 0;
      if (hasColors) { params.push(colorArray); }
      if (hasSizes) { params.push(sizeArray); }
      const colorsParam = hasColors ? `$${++idx}` : null;
      const sizesParam = hasSizes ? `$${++idx}` : null;

      let existsCond = `EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0`;
      if (hasColors) existsCond += ` AND LOWER(v.color) = ANY(${colorsParam}::text[])`;
      if (hasSizes) existsCond += ` AND UPPER(v.size) = ANY(${sizesParam}::text[])`;
      existsCond += `)`;
      query += ` AND ${existsCond}`;
    }

    const result = await db.query(query, params);

    // Enrich with sold counts
    let rows = result.rows || [];
    const ids = rows.map(r => r.id).filter(id => Number.isInteger(id));
    if (ids.length) {
      const soldRes = await db.query(
        `SELECT product_id, COALESCE(SUM(quantity),0) AS sold
         FROM order_items
         WHERE product_id = ANY($1::int[])
         GROUP BY product_id`,
        [ids]
      );
      const soldMap = new Map(soldRes.rows.map(r => [Number(r.product_id), Number(r.sold || 0)]));
      rows = rows.map(r => ({ ...r, sold: soldMap.get(Number(r.id)) || 0 }));

      // Attach aggregated variant-based stock if present
      try {
        const stockAgg = await db.query(
          `SELECT product_id, COALESCE(SUM(stock),0) AS total_stock
             FROM product_variants
            WHERE product_id = ANY($1::int[])
            GROUP BY product_id`,
          [ids]
        );
        const stockMap = new Map(stockAgg.rows.map(r => [Number(r.product_id), Number(r.total_stock || 0)]));
        rows = rows.map(r => {
          const agg = stockMap.get(Number(r.id));
          return (typeof agg === 'number' && agg >= 0)
            ? { ...r, stock: agg }
            : r;
        });
      } catch (_) { /* optional */ }

      // Attach available variant colors (stock > 0) derived from product_variants
      try {
        const colorsRes = await db.query(
          `SELECT product_id, ARRAY_AGG(DISTINCT LOWER(color)) AS colors
             FROM product_variants
            WHERE product_id = ANY($1::int[]) AND COALESCE(stock,0) > 0
            GROUP BY product_id`,
          [ids]
        );
        const colorMap = new Map(colorsRes.rows.map(r => [Number(r.product_id), (r.colors || []).map(c => String(c).toLowerCase())]));
        rows = rows.map(r => ({ ...r, variant_colors: colorMap.get(Number(r.id)) || [] }));
      } catch (_) { /* optional */ }
    }

    if (req.xhr || req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json(rows); // for AJAX
    }

    const currentCategory = req.query.category || null;
    res.render("customer/products", { products: rows, user: req.session.user, currentCategory });
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
    const searchQuery = req.query.search;
    const categoryQuery = req.query.category;
    let result;
    
    console.log('📦 Products route - search:', searchQuery, 'category:', categoryQuery);
    
    // If there's a category query, filter by case-insensitive category match (partial match)
    if (categoryQuery && categoryQuery.trim() !== '') {
      console.log('Filtering by category:', categoryQuery.trim());
      const categoryTerm = `%${categoryQuery.trim()}%`;
      result = await db.query(
        "SELECT * FROM products WHERE category ILIKE $1",
        [categoryTerm]
      );
      console.log('Category filter found:', result.rows.length, 'products');
    }
    // If there's a search query, filter products by name or category
    else if (searchQuery && searchQuery.trim() !== '') {
      const searchTerm = `%${searchQuery.trim()}%`;
      console.log('Searching for:', searchTerm);
      result = await db.query(
        "SELECT * FROM products WHERE name ILIKE $1 OR category ILIKE $1",
        [searchTerm]
      );
      console.log('Search found:', result.rows.length, 'products');
    } else {
      console.log('Getting all products');
      result = await db.query("SELECT * FROM products");
      console.log('All products found:', result.rows.length);
    }
    
    let products = result.rows || [];
    console.log('Final products count:', products.length);

    // Attach sold counts for all products in one pass
    const ids = products.map(p => p.id).filter(id => Number.isInteger(id));
    if (ids.length) {
      const soldRes = await db.query(
        `SELECT product_id, COALESCE(SUM(quantity),0) AS sold
         FROM order_items
         WHERE product_id = ANY($1::int[])
         GROUP BY product_id`,
        [ids]
      );
      const soldMap = new Map(soldRes.rows.map(r => [Number(r.product_id), Number(r.sold || 0)]));
      products = products.map(p => ({ ...p, sold: soldMap.get(Number(p.id)) || 0 }));

      // Attach aggregated variant-based stock
      try {
        const stockAgg = await db.query(
          `SELECT product_id, COALESCE(SUM(stock),0) AS total_stock
             FROM product_variants
            WHERE product_id = ANY($1::int[])
            GROUP BY product_id`,
          [ids]
        );
        const stockMap = new Map(stockAgg.rows.map(r => [Number(r.product_id), Number(r.total_stock || 0)]));
        products = products.map(p => {
          const agg = stockMap.get(Number(p.id));
          return { ...p, stock: (typeof agg === 'number' && agg >= 0) ? agg : undefined };
        });
      } catch (_) { /* optional */ }

      // Attach available variant colors (stock > 0) derived from product_variants
      try {
        const colorsRes = await db.query(
          `SELECT product_id, ARRAY_AGG(DISTINCT LOWER(color)) AS colors
             FROM product_variants
            WHERE product_id = ANY($1::int[]) AND COALESCE(stock,0) > 0
            GROUP BY product_id`,
          [ids]
        );
        const colorMap = new Map(colorsRes.rows.map(r => [Number(r.product_id), (r.colors || []).map(c => String(c).toLowerCase())]));
        products = products.map(p => ({ ...p, variant_colors: colorMap.get(Number(p.id)) || [] }));
      } catch (_) { /* optional */ }
    }

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
  const searchTerm = req.query.search || null;
  res.render("customer/products", { 
    products, 
    user: req.session.user, 
    currentCategory, 
    searchQuery: searchTerm 
  });
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

    // Per-variant stock map: { colorLower: { SIZE: count } }
    let variantStock = {};
    try {
      const vrows = await db.query(
        `SELECT LOWER(color) AS color, UPPER(size) AS size, stock FROM product_variants WHERE product_id = $1`,
        [id]
      );
      for (const r of vrows.rows) {
        const c = String(r.color || '').toLowerCase();
        const s = String(r.size || '').toUpperCase();
        const n = Number(r.stock || 0);
        if (!variantStock[c]) variantStock[c] = {};
        variantStock[c][s] = n;
      }
      // Reflect total as sum for consistency
      const total = Object.values(variantStock).reduce((sum, sizeMap) => sum + Object.values(sizeMap).reduce((a,b)=>a+Math.max(0,Number(b||0)),0), 0);
      if (total || total === 0) product.stock = total;
    } catch (_) { /* ignore */ }

    // Total sold for this product
    try {
      const sres = await db.query(
        `SELECT COALESCE(SUM(quantity),0) AS sold FROM order_items WHERE product_id = $1`,
        [id]
      );
      product.sold = Number(sres.rows[0]?.sold || 0);
    } catch (_) {
      product.sold = 0;
    }

    // Convert price to number
    product.price = Number(product.price);

    // Images array
    const images = [product.image_url, product.image_url_2, product.image_url_3, product.image_url_4].filter(img => img && img.trim() !== "");
    const safeImages = images.length > 0 ? images : ['/image/default.png'];

    // Colors and sizes
    // Prefer deriving from product_variants (variantStock) so UI reflects real availability
    let colors = product.colors ? product.colors.split(",").map(c => c.trim().toLowerCase()) : [];
    let sizes = product.sizes ? product.sizes.split(",").map(s => s.trim().toUpperCase()) : [];
    try {
      if (variantStock && Object.keys(variantStock).length > 0) {
        // Colors that have any stock > 0
        colors = Object.entries(variantStock)
          .filter(([_, sizeMap]) => Object.values(sizeMap || {}).some(n => Number(n || 0) > 0))
          .map(([c]) => String(c).toLowerCase());
        // Union of sizes that have any stock > 0 across all colors
        const sset = new Set();
        for (const sizeMap of Object.values(variantStock)) {
          for (const [k, v] of Object.entries(sizeMap || {})) {
            if (Number(v || 0) > 0) sset.add(String(k).toUpperCase());
          }
        }
        sizes = Array.from(sset);
      }
    } catch (_) { /* fallback to product.* if any issue */ }
    const allColors = ["black","red","blue","green"];
    const allSizes = ["S","M","L","XL"];

    // Rating
    product.rating = Math.min(Math.max(Number(product.rating) || 0, 0), 5);

    // Reviews list (best-effort if table exists)
    let reviews = [];
    let reviewBreakdown = null;
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
        [id]
      );
      reviews = rv.rows || [];
      // breakdown counts for 1..5
      const bd = await db.query(
        `SELECT rating, COUNT(*) AS count
           FROM product_reviews
          WHERE product_id = $1
          GROUP BY rating`,
        [id]
      );
      const map = {1:0,2:0,3:0,4:0,5:0};
      for (const row of bd.rows) {
        const r = Number(row.rating);
        const c = Number(row.count);
        if (r>=1 && r<=5) map[r] = c;
      }
      const total = Object.values(map).reduce((a,b)=>a+b,0);
      reviewBreakdown = { counts: map, total };
    } catch (err) {
      // Table may not exist yet; fail silently for display
      reviews = [];
      reviewBreakdown = null;
    }

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
      variantStock,
      user: req.session.user,
      userWishlisted,
      reviews,
      reviewBreakdown,
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
  const { color, size } = req.body || {};

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  try {
    // Check if this exact variant exists in wishlist
    const existing = await db.query(
      "SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2 AND color = $3 AND size = $4",
      [userId, productId, color || null, size || null]
    );

    if (existing.rows.length > 0) {
      // Remove from wishlist
      await db.query(
        "DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2 AND color = $3 AND size = $4",
        [userId, productId, color || null, size || null]
      );
      return res.json({ wishlisted: false, message: "Removed from wishlist" });
    } else {
      // Add to wishlist with color and size
      await db.query(
        "INSERT INTO wishlist (user_id, product_id, color, size) VALUES ($1, $2, $3, $4)",
        [userId, productId, color || null, size || null]
      );
      return res.json({ wishlisted: true, message: "Added to wishlist" });
    }
  } catch (err) {
    console.error("❌ Wishlist error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------
// Submit a product review
// -------------------
router.post("/products/:id/reviews", ensureAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const productId = Number(req.params.id);
  const { rating, comment } = req.body || {};
  const r = Math.max(1, Math.min(5, Number(rating || 5)));

  if (!productId || Number.isNaN(productId)) {
    return res.status(400).send("Invalid product ID");
  }

  try {
    // Ensure table exists (lightweight guard)
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    // Insert review
    await db.query(
      `INSERT INTO product_reviews (product_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)`,
      [productId, userId, r, comment || null]
    );

    // Update product aggregate rating and count if columns exist
    try {
      const cur = await db.query(`SELECT rating, reviews FROM products WHERE id = $1`, [productId]);
      if (cur.rows.length) {
        const curRating = Number(cur.rows[0].rating) || 0;
        const curCount = Number(cur.rows[0].reviews) || 0;
        const newCount = curCount + 1;
        const newAvg = newCount > 0 ? ((curRating * curCount + r) / newCount) : r;
        await db.query(`UPDATE products SET rating = $1, reviews = $2 WHERE id = $3`, [newAvg, newCount, productId]);
      }
    } catch (aggErr) {
      // If products table lacks columns, ignore silently
    }

    res.redirect(`/products/${productId}#reviews-section`);
  } catch (err) {
    console.error("❌ Error submitting review:", err);
    res.status(500).send("Server error");
  }
});




export default router;
