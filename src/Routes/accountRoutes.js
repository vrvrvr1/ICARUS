// src/Routes/accountRoutes.js
import express from "express";
import db from "../database/db.js";
import multer from "multer";
import path from "path";

const router = express.Router();

// ✅ Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ✅ Multer setup for profile uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "src/public/uploads");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix);
  },
});

const upload = multer({ storage });

/* ==============================
   PROFILE IMAGE UPLOAD
============================== */
router.post(
  "/accountsettings/upload",
  upload.single("profile_pic"),
  async (req, res) => {
    try {
      const userId = req.session.user.id;

      const filePath = "/uploads/" + req.file.filename;

      await db.query(
        "UPDATE customers SET profile_image = $1 WHERE id = $2",
        [filePath, userId]
      );

      res.redirect("/accountsettings");
    } catch (err) {
      console.error("Error uploading profile picture:", err);
      res.status(500).send("Server error");
    }
  }
);

/* ==============================
   ACCOUNT SETTINGS (GET)
============================== */
router.get("/", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;

  try {
    // ✅ Fetch user info (no username)
    const result = await db.query(
      "SELECT id, email, role, profile_image FROM customers WHERE id = $1",
      [userId]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).send("User not found");
    }

    // ✅ Default profile image
    if (!user.profile_image) {
      user.profile_pic = "/image/profile1.png";
    } else {
      user.profile_pic = user.profile_image;
    }

    // ✅ Fetch wishlist
    const wishlistQuery = await db.query(
      `SELECT w.id AS wishlist_id, 
              p.id AS product_id, 
              p.name AS product_name, 
              p.image_url, 
              p.price
       FROM wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = $1`,
      [userId]
    );
    const wishlistItems = wishlistQuery.rows;

    res.render("customer/accountsettings", {
      user,
      wishlistItems,
    });
  } catch (err) {
    console.error("Error fetching account info:", err);
    res.status(500).send("Server Error");
  }
});

/* ==============================
   REMOVE WISHLIST ITEM
============================== */
router.delete("/wishlist/remove/:id", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const wishlistId = req.params.id;

  try {
    await db.query(
      "DELETE FROM wishlist WHERE id = $1 AND user_id = $2",
      [wishlistId, userId]
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error removing wishlist item:", err);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});

/* ==============================
   UPDATE EMAIL
============================== */
router.post("/update-email", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { email } = req.body;

  try {
    await db.query("UPDATE customers SET email = $1 WHERE id = $2", [
      email,
      userId,
    ]);

    req.session.user.email = email;

    res.redirect("/accountsettings");
  } catch (err) {
    console.error("Error updating email:", err);
    res.status(500).send("Server Error");
  }
});

/* ==============================
   UPDATE PASSWORD
============================== */
router.post("/update-password", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { password } = req.body;

  try {
    // ⚠️ In production use bcrypt!
    // const hashed = await bcrypt.hash(password, 10);

    await db.query("UPDATE customers SET password = $1 WHERE id = $2", [
      password,
      userId, // replace with [hashed, userId] if using bcrypt
    ]);

    res.redirect("/accountsettings");
  } catch (err) {
    console.error("Error updating password:", err);
    res.status(500).send("Server Error");
  }
});

export default router;
