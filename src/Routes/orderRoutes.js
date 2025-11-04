// src/Routes/orderRoutes.js
import express from "express";
import db from "../database/db.js";
import storeConfig from "../utils/storeConfig.js";

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

// GET /orders/:orderId — lightweight order details (redirects to receipt for now)
router.get("/orders/:orderId", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  try {
    const orderRes = await db.query(
      `SELECT *, COALESCE(order_date, created_at) AS created_on
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    if (!orderRes.rows.length) return res.status(404).send("Order not found");

    // For now, redirect to the receipt page you already have
    return res.redirect(`/checkout/confirmation/${orderId}`);
  } catch (err) {
    console.error("Order details error:", err);
    return res.status(500).send("Server error");
  }
});

// GET /orders/:orderId/track — tracking page with status timeline and map
router.get("/orders/:orderId/track", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  try {
    const orderRes = await db.query(
      `SELECT id, status, payment_method, payment_completed,
              estimated_delivery,
              estimated_delivery_start,
              estimated_delivery_end,
              cancelled_at,
              cancellation_reason,
              refund_status,
              refund_amount,
              refund_processed_at,
              COALESCE(order_date, created_at) AS created_on
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    if (!orderRes.rows.length) return res.status(404).send("Order not found");
    const order = orderRes.rows[0];

    // Optionally load per-status timestamps if the columns exist in the DB
    let statusTimes = {};
    try {
      const colsRes = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = ANY($1)`,
        [["paid_at", "shipped_at", "out_for_delivery_at", "delivered_at"]]
      );
      const cols = new Set((colsRes.rows || []).map(r => r.column_name));
      const wanted = Array.from(cols);
      if (wanted.length) {
        const selectList = wanted.map(c => `${c}`).join(", ");
        const tsRes = await db.query(`SELECT ${selectList} FROM orders WHERE id = $1`, [orderId]);
        statusTimes = tsRes.rows[0] || {};
      }
    } catch (e) {
      // If schema check fails or columns missing, proceed without timestamps
      statusTimes = {};
    }

    // Derive step states from status/payment
    const statusText = (order.status || '').toLowerCase();
    const paid = !!order.payment_completed || order.payment_method === 'COD';
    const shipped = /ship|out/.test(statusText);
    const delivered = /deliver|complete/.test(statusText);

    const steps = [
      { key: 'placed', label: 'Order placed', done: true },
      { key: 'paid', label: paid ? 'Payment confirmed' : 'Awaiting payment', done: paid },
      { key: 'shipped', label: 'Shipped', done: shipped || delivered },
      { key: 'delivered', label: 'Delivered', done: delivered },
    ];

    // Fetch order items for summary
    const itemsRes = await db.query(`
      SELECT oi.order_id,
             COALESCE(oi.product_name, p.name) AS product_name,
             COALESCE(oi.image_url, p.image_url) AS image_url,
             oi.quantity,
             oi.price
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `, [orderId]);

    const items = itemsRes.rows.map(r => ({
      product_name: r.product_name,
      image_url: r.image_url,
      quantity: Number(r.quantity || 0),
      price: Number(r.price || 0)
    }));

    const total = items.reduce((sum, it) => sum + it.quantity * it.price, 0);

  res.render("customer/order-track", { user: req.session.user, order, steps, store: storeConfig, items, total, statusTimes });
  } catch (err) {
    console.error("Order track error:", err);
    return res.status(500).send("Server error");
  }
});

// POST /orders/:orderId/cancel - Customer cancels their order
router.post("/orders/:orderId/cancel", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  const { cancellation_reason } = req.body;
  
  try {
    console.log('🔄 Processing order cancellation:', orderId, 'by customer:', customerId);
    
    // Get order details and verify ownership
    const orderRes = await db.query(
      `SELECT id, customer_id, status, cancelled_at, payment_method 
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    
    if (!orderRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderRes.rows[0];
    
    // Check if already cancelled
    if (order.cancelled_at) {
      return res.status(400).json({ success: false, error: 'Order already cancelled' });
    }
    
    // Check if order can be cancelled (only allow for certain statuses)
    const statusLower = (order.status || '').toLowerCase();
    const isDelivered = /deliver|complete/.test(statusLower);
    const isShipped = /ship|out|route|courier/.test(statusLower);
    
    // Don't allow cancellation if already delivered
    if (isDelivered) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot cancel order that has already been delivered. Please request a refund instead.' 
      });
    }
    
    // Check if order was paid
    const isPaid = order.payment_method === 'PayPal' || order.payment_completed;
    
    // Warn if already shipped (but still allow)
    let warningMessage = '';
    if (isShipped) {
      warningMessage = 'Order has already been shipped. ';
    }
    
    // Add refund message if paid
    if (isPaid) {
      warningMessage += 'A refund will be processed to your original payment method within 5-7 business days.';
    }
    
    const now = new Date();
    
    // Get order total for refund
    let orderTotal = 0;
    if (isPaid) {
      const totalRes = await db.query(
        `SELECT COALESCE(total, 0) as total,
                COALESCE((SELECT SUM(quantity * price) FROM order_items WHERE order_id = $1), 0) as items_total
         FROM orders WHERE id = $1`,
        [orderId]
      );
      orderTotal = Number(totalRes.rows[0]?.total || totalRes.rows[0]?.items_total || 0);
    }
    
    // Start transaction
    await db.query('BEGIN');
    
    try {
      // Update order status to cancelled
      await db.query(
        `UPDATE orders SET 
          status = 'Cancelled',
          cancelled_at = $1,
          cancellation_reason = $2,
          cancelled_by = $3
        WHERE id = $4`,
        [now, cancellation_reason, customerId, orderId]
      );
      
      // Process automatic refund if order was paid
      if (isPaid && orderTotal > 0) {
        console.log('📝 Processing automatic refund for cancelled order:', orderId, 'Amount:', orderTotal);
        
        try {
          // Update refund information in orders table
          await db.query(
            `UPDATE orders SET 
              refund_status = 'pending',
              refund_amount = $1,
              refund_reason = $2,
              refund_requested_at = $3
            WHERE id = $4`,
            [orderTotal, 'Order cancelled by customer', now, orderId]
          );
          
          // Insert into refunds table for tracking
          await db.query(
            `INSERT INTO refunds (
              order_id, customer_id, refund_amount, refund_reason, 
              refund_type, status, requested_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              orderId, customerId, orderTotal, 
              'Order cancelled by customer', 
              'full', 'pending', now
            ]
          );
          
          console.log('✅ Automatic refund initiated for order:', orderId);
        } catch (e) {
          console.error('❌ Error creating refund record:', e.message);
          // Continue with cancellation even if refund record fails
        }
      }
      
      // Create notification for customer about cancellation and refund
      try {
        const notificationBody = isPaid 
          ? `Your order #${orderId} has been cancelled. A refund of $${orderTotal.toFixed(2)} will be processed to your original payment method within 5-7 business days.`
          : `Your order #${orderId} has been cancelled successfully.`;
        
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link) 
           VALUES ($1, $2, $3, $4)`,
          [
            customerId,
            'Order Cancelled',
            notificationBody,
            `/orders/${orderId}/track`
          ]
        );
      } catch (e) {
        console.warn('Could not create customer notification:', e.message);
      }
      
      // Create notification for admin
      try {
        const adminBody = isPaid
          ? `Customer cancelled order #${orderId}. Refund of $${orderTotal.toFixed(2)} pending approval. Reason: ${cancellation_reason || 'Not specified'}`
          : `Customer cancelled order #${orderId}. Reason: ${cancellation_reason || 'Not specified'}`;
        
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link) 
           VALUES (
             (SELECT id FROM customers WHERE role = 'admin' LIMIT 1),
             $1, $2, $3
           )`,
          [
            isPaid ? 'Order Cancelled - Refund Pending' : 'Order Cancelled',
            adminBody,
            `/admin/orders/${orderId}`
          ]
        );
      } catch (e) {
        console.warn('Could not create admin notification:', e.message);
      }
      
      await db.query('COMMIT');
      
      console.log('✅ Order cancelled successfully:', orderId);
      
      const successMessage = isPaid 
        ? `Order cancelled successfully. A refund of $${orderTotal.toFixed(2)} will be processed within 5-7 business days.`
        : 'Order cancelled successfully';
      
      res.json({ 
        success: true, 
        message: successMessage,
        refund_initiated: isPaid,
        refund_amount: isPaid ? orderTotal : undefined,
        warning: warningMessage || undefined
      });
      
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    
  } catch (err) {
    console.error('❌ Error cancelling order:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cancel order. Please try again or contact support.' 
    });
  }
});

// POST /orders/:orderId/request-refund - Customer requests refund for delivered order
router.post("/orders/:orderId/request-refund", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  const { reason, details } = req.body;
  
  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Refund reason is required' });
  }
  
  try {
    console.log('🔄 Processing refund request for order:', orderId, 'by customer:', customerId);
    
    // Get order details and verify ownership
    const orderRes = await db.query(
      `SELECT id, customer_id, status, payment_method, payment_completed, 
              refund_status, total, COALESCE(order_date, created_at) AS created_on
       FROM orders WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId]
    );
    
    if (!orderRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderRes.rows[0];
    
    // Check if payment was completed
    if (!order.payment_completed) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot request refund for unpaid orders. You can cancel the order instead.' 
      });
    }
    
    // Check if order is delivered
    const statusLower = (order.status || '').toLowerCase();
    const isDelivered = /deliver|complete/.test(statusLower);
    
    if (!isDelivered) {
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
    
    const now = new Date();
    const orderTotal = Number(order.total || 0);
    
    // Combine reason and details
    const fullReason = details ? `${reason}: ${details}` : reason;
    
    // Update order with refund request
    await db.query(
      `UPDATE orders SET 
        refund_status = 'requested',
        refund_requested_at = $1,
        refund_reason = $2,
        refund_amount = $3
      WHERE id = $4`,
      [now, fullReason.trim(), orderTotal, orderId]
    );
    
    // Create notification for all admins
    try {
      const adminUsers = await db.query(
        "SELECT id FROM customers WHERE role = 'admin'"
      );
      
      if (adminUsers.rows.length === 0) {
        console.warn('⚠️ No admin users found to notify about refund request');
      }
      
      for (const admin of adminUsers.rows) {
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link, type) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            admin.id,
            'Refund Request',
            `Customer requested refund for order #${orderId}. Amount: $${orderTotal.toFixed(2)}. Reason: ${reason}`,
            `/admin/orders/${orderId}`,
            'refund'
          ]
        );
        console.log(`✅ Notification sent to admin ${admin.id} for refund request on order #${orderId}`);
      }
    } catch (notifErr) {
      console.error('❌ Could not create admin notification:', notifErr.message);
    }
    
    console.log(`✅ Refund request created for order #${orderId} by customer ${customerId}`);
    
    return res.json({ 
      success: true, 
      message: 'Refund request submitted successfully. An admin will review it shortly.' 
    });
    
  } catch (err) {
    console.error('❌ Error processing refund request:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to submit refund request. Please try again or contact support.' 
    });
  }
});

// GET /orders/:orderId/items - Get order items for review modal
router.get("/orders/:orderId/items", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  
  try {
    // Verify order ownership
    const orderRes = await db.query(
      'SELECT id FROM orders WHERE id = $1 AND customer_id = $2',
      [orderId, customerId]
    );
    
    if (!orderRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Get order items
    const itemsRes = await db.query(`
      SELECT oi.product_id,
             oi.product_name,
             oi.image_url,
             oi.quantity,
             oi.price
      FROM order_items oi
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `, [orderId]);
    
    return res.json({
      success: true,
      items: itemsRes.rows
    });
  } catch (error) {
    console.error('Error fetching order items:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /orders/:orderId/review - Submit review for delivered order
router.post("/orders/:orderId/review", isAuthenticated, async (req, res) => {
  const { orderId } = req.params;
  const customerId = req.session.user.id;
  const { rating, comment } = req.body;
  
  // Validation
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'Please provide a rating between 1 and 5' });
  }
  
  if (!comment || comment.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'Review must be at least 10 characters long' });
  }
  
  try {
    console.log('🔄 Processing review for order:', orderId, 'by customer:', customerId);
    
    // Verify order ownership and status
    const orderRes = await db.query(
      `SELECT id, customer_id, status, reviewed_at 
       FROM orders WHERE id = $1 AND customer_id = $2`,
      [orderId, customerId]
    );
    
    if (!orderRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderRes.rows[0];
    
    // Check if already reviewed
    if (order.reviewed_at) {
      return res.status(400).json({ 
        success: false, 
        error: 'You have already reviewed this order' 
      });
    }
    
    // Check if order is delivered
    const statusLower = (order.status || '').toLowerCase();
    const isDelivered = /deliver|complete/.test(statusLower);
    
    if (!isDelivered) {
      return res.status(400).json({ 
        success: false, 
        error: 'You can only review delivered orders' 
      });
    }
    
    const now = new Date();
    
    // Get order items to create reviews for each product
    const itemsRes = await db.query(
      'SELECT product_id FROM order_items WHERE order_id = $1',
      [orderId]
    );
    
    // Start transaction
    await db.query('BEGIN');
    
    try {
      // Create reviews for each product in the order
      for (const item of itemsRes.rows) {
        await db.query(
          `INSERT INTO reviews (product_id, customer_id, order_id, rating, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (order_id, product_id) DO NOTHING`,
          [item.product_id, customerId, orderId, rating, comment.trim(), now]
        );
      }
      
      // Mark order as reviewed
      await db.query(
        'UPDATE orders SET reviewed_at = $1 WHERE id = $2',
        [now, orderId]
      );
      
      await db.query('COMMIT');
      
      console.log(`✅ Review submitted for order #${orderId} by customer ${customerId}`);
      
      return res.json({ 
        success: true, 
        message: 'Thank you for your review!' 
      });
      
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    
  } catch (error) {
    console.error('❌ Error submitting review:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to submit review. Please try again.' 
    });
  }
});

export default router;
