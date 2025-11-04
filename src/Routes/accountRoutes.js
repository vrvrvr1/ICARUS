// src/Routes/accountRoutes.js
import express from "express";
import db from "../database/db.js";
import multer from "multer";
import path from "path";
import bcrypt from "bcrypt";

const router = express.Router();

// ✅ Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ==============================
// PROFILE IMAGE UPLOAD (Profile tab)
// ==============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "src/public/uploads"),
  filename: (req, file, cb) => cb(null, `profile-${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

router.post("/accountsettings/upload", isAuthenticated, upload.single("profile_pic"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/accountsettings?tab=account");
    const userId = req.session.user.id;
    const filePath = "/uploads/" + req.file.filename;
    await db.query("UPDATE customers SET profile_image = $1 WHERE id = $2", [filePath, userId]);
    // reflect in session
    req.session.user.profile_image = filePath;
    req.session.notice = { type: 'success', message: 'Profile photo updated.' };
    res.redirect("/accountsettings?tab=account");
  } catch (err) {
    console.error("Error uploading profile picture:", err);
    req.session.notice = { type: 'error', message: 'Failed to update profile photo.' };
    res.redirect("/accountsettings?tab=account");
  }
});

/* ==============================
   ACCOUNT SETTINGS (GET)
============================== */
router.get("/", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;

  try {
    // ✅ Fetch user info
    const result = await db.query(
      "SELECT id, email, role, profile_image, first_name, last_name, (password IS NOT NULL) AS has_password FROM customers WHERE id = $1",
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
              p.price,
              w.color,
              w.size
       FROM wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = $1`,
      [userId]
    );
    const wishlistItems = wishlistQuery.rows;

    // ✅ Fetch user's orders (most recent first)
    const ordersResult = await db.query(`
      SELECT o.id,
             o.order_date,
             o.status,
             o.estimated_delivery,
             o.estimated_delivery_start,
             o.estimated_delivery_end,
             o.cancelled_at,
             o.cancellation_reason,
             o.total AS total_amount
      FROM orders o
      WHERE o.customer_id = $1
      ORDER BY o.order_date DESC
      LIMIT 20
    `, [userId]);

    let myOrders = ordersResult.rows.map(r => ({
      ...r,
      total_amount: Number(r.total_amount || 0)
    }));

    // ✅ Fetch items for these orders in one query and attach to each order
    const orderIds = myOrders.map(o => o.id);
    if (orderIds.length) {
      const itemsResult = await db.query(`
        SELECT oi.order_id,
               oi.product_id,
               COALESCE(oi.product_name, p.name) AS product_name,
               COALESCE(oi.image_url, p.image_url) AS image_url,
               oi.quantity,
               oi.price
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ANY($1::int[])
        ORDER BY oi.order_id, oi.id
      `, [orderIds]);
      const byOrder = {};
      for (const row of itemsResult.rows) {
        const id = row.order_id;
        if (!byOrder[id]) byOrder[id] = [];
        byOrder[id].push({
          product_id: row.product_id,
          product_name: row.product_name,
          image_url: row.image_url,
          quantity: Number(row.quantity || 0),
          price: Number(row.price || 0)
        });
      }
      myOrders = myOrders.map(o => ({ ...o, items: byOrder[o.id] || [] }));
    }

    // ✅ Dashboard summary metrics
    // Total orders
    const totalOrdersRes = await db.query(`SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=$1`, [userId]);
    const totalOrders = Number(totalOrdersRes.rows[0]?.cnt || 0);

    // Total spent (sum of all order_items for this customer's orders)
    const totalSpentRes = await db.query(`
      SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS total
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = $1
    `, [userId]);
    const totalSpent = Number(totalSpentRes.rows[0]?.total || 0);

    // Last order
    const lastOrderRes = await db.query(`
      SELECT id, status, order_date
      FROM orders
      WHERE customer_id=$1
      ORDER BY order_date DESC
      LIMIT 1
    `, [userId]);
    const lastOrder = lastOrderRes.rows[0] || null;

    // Status bucketing counts
    const bucketRes = await db.query(`
      SELECT 
        SUM(CASE WHEN LOWER(COALESCE(status,'')) ~ '(deliver|complete)' THEN 1 ELSE 0 END) AS to_review,
        SUM(CASE WHEN LOWER(COALESCE(status,'')) ~ '(ship|en route|courier|out)' 
                  AND NOT (LOWER(COALESCE(status,'')) ~ '(deliver|complete)') THEN 1 ELSE 0 END) AS to_receive,
        SUM(CASE WHEN NOT (LOWER(COALESCE(status,'')) ~ '(ship|en route|courier|out|deliver|complete|cancel)') THEN 1 ELSE 0 END) AS to_ship,
        SUM(CASE WHEN LOWER(COALESCE(status,'')) ~ '(cancel)' THEN 1 ELSE 0 END) AS cancelled
      FROM orders
      WHERE customer_id=$1
    `, [userId]);
    const buckets = bucketRes.rows[0] || {};

    // Wishlist count
    const wishlistCount = wishlistItems.length;

    // Addresses count
    let addressesCount = 0;
    try {
      const addrRes = await db.query(`SELECT COUNT(*) AS cnt FROM addresses WHERE customer_id = $1`, [userId]);
      addressesCount = Number(addrRes.rows[0]?.cnt || 0);
    } catch (e) {
      addressesCount = 0; // if table doesn't exist, ignore
    }

    const avgOrderValue = totalOrders > 0 ? (totalSpent / totalOrders) : 0;

    const summary = {
      totalOrders,
      totalSpent,
      avgOrderValue,
      lastOrder,
      toShip: Number(buckets.to_ship || 0),
      toReceive: Number(buckets.to_receive || 0),
      toReview: Number(buckets.to_review || 0),
      cancelled: Number(buckets.cancelled || 0),
      wishlistCount,
      addressesCount
    };

    const notice = req.session.notice;
    delete req.session.notice;

    // Active store announcements (best-effort)
    let announcements = [];
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
      const ares = await db.query('SELECT id, title, body, created_at FROM announcements WHERE active = true ORDER BY created_at DESC LIMIT 5');
      announcements = ares.rows || [];
    } catch (_) { announcements = []; }

    // Recent notifications (best-effort; ignore if table missing)
    let notifications = [];
    try {
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
      const nres = await db.query(
        `SELECT id, title, body, link, is_read, created_at
           FROM user_notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [userId]
      );
      notifications = nres.rows || [];
    } catch (_) {
      notifications = [];
    }

    res.render("customer/accountsettings", {
      user,
      wishlistItems,
      myOrders,
      summary,
      notice,
      notifications,
      announcements,
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
  const emailNorm = (email || '').trim().toLowerCase();

  try {
    await db.query("UPDATE customers SET email = $1 WHERE id = $2", [
      emailNorm,
      userId,
    ]);

  req.session.user.email = emailNorm;
    req.session.notice = { type: 'success', message: 'Email updated.' };
    res.redirect("/accountsettings");
  } catch (err) {
    console.error("Error updating email:", err);
    req.session.notice = { type: 'error', message: 'Failed to update email.' };
    res.redirect("/accountsettings");
  }
});

/* ==============================
   UPDATE PASSWORD
============================== */
router.post("/update-password", isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { current_password, new_password, confirm_password } = req.body || {};
  const cur = (current_password || '').trim();
  const npw = (new_password || '').trim();
  const cfm = (confirm_password || '').trim();

  try {
    // Fetch current hash
    const { rows } = await db.query('SELECT email, password FROM customers WHERE id=$1', [userId]);
    if (!rows.length) {
      req.session.notice = { type: 'error', message: 'Account not found.' };
      return res.redirect('/accountsettings?tab=account');
    }
    const existingHash = rows[0].password;
    if (existingHash) {
      // Current password required only if a password already exists
      if (!cur) {
        req.session.notice = { type: 'error', message: 'Please enter your current password.' };
        return res.redirect('/accountsettings?tab=account');
      }
      const ok = await bcrypt.compare(cur, existingHash);
      if (!ok) {
        req.session.notice = { type: 'error', message: 'Current password is incorrect.' };
        return res.redirect('/accountsettings?tab=account');
      }
    }

    // If user opened change panel, validate new passwords
    if (!npw || npw.length < 6) {
      req.session.notice = { type: 'error', message: 'New password must be at least 6 characters.' };
      return res.redirect('/accountsettings?tab=account');
    }
    if (npw !== cfm) {
      req.session.notice = { type: 'error', message: 'New password and confirm do not match.' };
      return res.redirect('/accountsettings?tab=account');
    }
    if (existingHash && npw === cur) {
      req.session.notice = { type: 'error', message: 'New password must be different from current password.' };
      return res.redirect('/accountsettings?tab=account');
    }

    const hashed = await bcrypt.hash(npw, 10);
    await db.query('UPDATE customers SET password = $1 WHERE id = $2', [hashed, userId]);
    // Best-effort: synchronize duplicates (same email, different ids)
    await db.query(
      `UPDATE customers c
       SET password = $1
       FROM customers u
       WHERE u.id = $2 AND LOWER(TRIM(c.email)) = LOWER(TRIM(u.email)) AND c.id <> u.id`,
      [hashed, userId]
    );

    // Verify the stored hash immediately to catch schema truncation issues
    const chk = await db.query('SELECT password FROM customers WHERE id = $1', [userId]);
    const savedHash = chk.rows[0]?.password || '';
    const verifies = savedHash && await bcrypt.compare(npw, savedHash);
    if (!verifies) {
      console.error('[password-update] Hash verification failed after update. Stored length:', savedHash ? savedHash.length : 0);
      req.session.notice = { type: 'error', message: 'Password could not be verified after saving. Please contact support.' };
      return res.redirect('/accountsettings?tab=account');
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[password-update] userId=${userId} email=${rows[0].email} password updated and verified (len=${savedHash.length})`);
    }
    req.session.notice = { type: 'success', message: 'Password updated.' };
    res.redirect('/accountsettings?tab=account');
  } catch (err) {
    console.error('Error updating password:', err);
    req.session.notice = { type: 'error', message: 'Failed to update password.' };
    res.redirect('/accountsettings?tab=account');
  }
});

// (Username feature removed as not present in DB)

/* ==============================
   UPDATE BASIC PROFILE (first/last name)
============================== */
router.post('/update-profile', isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const { first_name, last_name, email } = req.body || {};
  try {
    if ((first_name && String(first_name).length > 100) || (last_name && String(last_name).length > 100)) {
      req.session.notice = { type: 'error', message: 'Names must be under 100 characters.' };
      return res.redirect('/accountsettings');
    }
    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;
  if (typeof first_name !== 'undefined') { fields.push(`first_name = $${idx++}`); values.push(first_name || null); }
  if (typeof last_name !== 'undefined') { fields.push(`last_name = $${idx++}`); values.push(last_name || null); }
  if (typeof email !== 'undefined') { fields.push(`email = $${idx++}`); values.push(email || null); }
    if (!fields.length) {
      req.session.notice = { type: 'error', message: 'Nothing to update.' };
      return res.redirect('/accountsettings');
    }
    values.push(userId);
    await db.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    // Reflect into session if present
  if (typeof first_name !== 'undefined') req.session.user.first_name = first_name || null;
  if (typeof last_name !== 'undefined') req.session.user.last_name = last_name || null;
  if (typeof email !== 'undefined') req.session.user.email = email || null;

    req.session.notice = { type: 'success', message: 'Profile updated.' };
    res.redirect('/accountsettings');
  } catch (err) {
    console.error('Error updating profile:', err);
    req.session.notice = { type: 'error', message: 'Failed to update profile.' };
    res.redirect('/accountsettings');
  }
});

/* ==============================
   CANCEL ORDER (customer-initiated)
============================== */
router.post('/orders/:id/cancel', isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const orderId = Number(req.params.id);
  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ success: false, error: 'Invalid order id' });
  }
  try {
    const { rows } = await db.query('SELECT id, status FROM orders WHERE id = $1 AND customer_id = $2', [orderId, userId]);
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const s = String(order.status || '').toLowerCase();
    // Disallow cancel once shipped or delivered or already cancelled
    if (s.includes('ship') || s.includes('courier') || s.includes('out') || s.includes('deliver') || s.includes('cancel')) {
      return res.status(400).json({ success: false, error: 'Order can no longer be cancelled.' });
    }
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['Cancelled', orderId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Cancel order error:', err);
    return res.status(500).json({ success: false, error: 'Server Error' });
  }
});

/* ==============================
   REQUEST REFUND (customer-initiated)
============================== */
router.post('/orders/:id/request-refund', isAuthenticated, async (req, res) => {
  const userId = req.session.user.id;
  const orderId = Number(req.params.id);
  const { reason } = req.body;
  
  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ success: false, error: 'Invalid order id' });
  }
  
  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Refund reason is required' });
  }
  
  try {
    const { rows } = await db.query(
      'SELECT id, status, payment_method, payment_completed, refund_status, total FROM orders WHERE id = $1 AND customer_id = $2',
      [orderId, userId]
    );
    
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Check if payment was completed
    if (!order.payment_completed) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot request refund for unpaid orders. You can cancel the order instead.' 
      });
    }
    
    const status = String(order.status || '').toLowerCase();
    
    // Only allow refund requests for delivered orders or specific statuses
    if (!status.includes('deliver') && !status.includes('complete')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Refunds can only be requested for delivered orders. You can cancel pending orders instead.' 
      });
    }
    
    // Check if refund already requested/processed
    if (order.refund_status) {
      const refundStatus = String(order.refund_status).toLowerCase();
      if (refundStatus === 'processed') {
        return res.status(400).json({ 
          success: false, 
          error: 'This order has already been refunded.' 
        });
      }
      if (refundStatus === 'requested' || refundStatus === 'pending') {
        return res.status(400).json({ 
          success: false, 
          error: 'A refund request for this order is already pending review.' 
        });
      }
    }
    
    // Update order with refund request
    await db.query(
      `UPDATE orders SET 
        refund_status = 'requested',
        refund_requested_at = NOW(),
        refund_reason = $1,
        refund_amount = $2
      WHERE id = $3`,
      [reason.trim(), order.total, orderId]
    );
    
    // Create notification for all admins
    try {
      const adminUsers = await db.query(
        "SELECT id FROM users WHERE role = 'admin'"
      );
      
      for (const admin of adminUsers.rows) {
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link, type) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            admin.id,
            'Refund Request',
            `Customer requested refund for order #${orderId}. Amount: $${Number(order.total).toFixed(2)}`,
            `/admin/orders/${orderId}`,
            'refund'
          ]
        );
      }
    } catch (notifErr) {
      console.warn('Could not create admin notification:', notifErr.message);
    }
    
    console.log(`✅ Refund request created for order #${orderId} by user ${userId}`);
    
    return res.json({ 
      success: true, 
      message: 'Refund request submitted successfully. An admin will review it shortly.' 
    });
    
  } catch (err) {
    console.error('Request refund error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please try again later.' });
  }
});

export default router;
