// routes/searchRoutes.js
import express from "express";
import db from "../database/db.js";

const router = express.Router();

/**
 * GET /search
 * Used by modal (AJAX/Fetch request)
 * Returns JSON results
 */
router.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();

  try {
    const searchPattern = `%${query}%`;
    const result = await db.query(
      `SELECT DISTINCT id, name, price, image_url, category
       FROM products
       WHERE name ILIKE $1 OR category ILIKE $1
       ORDER BY name
       LIMIT 10`,
      [searchPattern]
    );

    // Remove duplicates by ID in JavaScript and filter smartly
    const uniqueProducts = [];
    const seenIds = new Set();
    const queryLower = query.toLowerCase();
    
    // Filter: prioritize word boundary matches (e.g., "mens" shouldn't match "womens")
    const filtered = result.rows.filter(product => {
      const name = (product.name || '').toLowerCase();
      const category = (product.category || '').toLowerCase();
      
      // Check if query matches as a word (not just substring)
      const wordBoundaryPattern = new RegExp(`\\b${queryLower}`, 'i');
      return wordBoundaryPattern.test(name) || wordBoundaryPattern.test(category);
    });
    
    // Sort: exact/starts-with matches first
    const sorted = filtered.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aCat = (a.category || '').toLowerCase();
      const bCat = (b.category || '').toLowerCase();
      
      // Exact matches first
      if (aCat === queryLower) return -1;
      if (bCat === queryLower) return 1;
      if (aName === queryLower) return -1;
      if (bName === queryLower) return 1;
      
      // Starts with query
      if (aCat.startsWith(queryLower) && !bCat.startsWith(queryLower)) return -1;
      if (bCat.startsWith(queryLower) && !aCat.startsWith(queryLower)) return 1;
      if (aName.startsWith(queryLower) && !bName.startsWith(queryLower)) return -1;
      if (bName.startsWith(queryLower) && !aName.startsWith(queryLower)) return 1;
      
      return 0;
    });
    
    for (const product of sorted) {
      if (!seenIds.has(product.id)) {
        seenIds.add(product.id);
        uniqueProducts.push(product);
      }
    }

    res.json(uniqueProducts);
  } catch (err) {
    console.error("❌ DB search error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
