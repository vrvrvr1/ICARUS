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
  const query = req.query.q || "";

  try {
    const result = await db.query(
      `SELECT id, name, price, image_url, category
       FROM products 
       WHERE name ILIKE $1
          OR category ILIKE $1
       LIMIT 10`,
      [`%${query}%`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ DB search error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
