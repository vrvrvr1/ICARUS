// src/Routes/chatRoutes.js
import express from "express";
import db from "../database/db.js";

const router = express.Router();

function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

function isAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  next();
}

/* ==============================
   CUSTOMER CHAT ENDPOINTS
============================== */

// GET /chat - Customer chat interface
router.get("/chat", isAuthenticated, async (req, res) => {
  const customerId = req.session.user.id;
  
  try {
    // Get or create conversation for this customer
    let conversation = await db.query(
      `SELECT c.*, 
              a.first_name as admin_first_name, 
              a.last_name as admin_last_name
       FROM chat_conversations c
       LEFT JOIN customers a ON c.admin_id = a.id
       WHERE c.customer_id = $1 AND c.status = 'active'
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [customerId]
    );
    
    let conversationId;
    
    if (conversation.rows.length === 0) {
      // Create new conversation
      const newConv = await db.query(
        `INSERT INTO chat_conversations (customer_id, status)
         VALUES ($1, 'active')
         RETURNING id`,
        [customerId]
      );
      conversationId = newConv.rows[0].id;
    } else {
      conversationId = conversation.rows[0].id;
    }
    
    res.render("customer/chat", {
      user: req.session.user,
      conversationId: conversationId
    });
  } catch (error) {
    console.error('Error loading chat:', error);
    res.status(500).send('Error loading chat');
  }
});

// GET /api/chat/messages - Get messages for customer's conversation
router.get("/api/chat/messages", isAuthenticated, async (req, res) => {
  const customerId = req.session.user.id;
  
  try {
    // Get customer's active conversation
    const convResult = await db.query(
      `SELECT id FROM chat_conversations 
       WHERE customer_id = $1 AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
      [customerId]
    );
    
    if (convResult.rows.length === 0) {
      return res.json({ success: true, messages: [] });
    }
    
    const conversationId = convResult.rows[0].id;
    
    // Get messages
    const messages = await db.query(
      `SELECT m.*, 
              c.first_name, 
              c.last_name,
              c.role
       FROM chat_messages m
       JOIN customers c ON m.sender_id = c.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );
    
    // Mark messages as read if sent by admin
    await db.query(
      `UPDATE chat_messages 
       SET is_read = TRUE 
       WHERE conversation_id = $1 
       AND sender_type = 'admin' 
       AND is_read = FALSE`,
      [conversationId]
    );
    
    res.json({
      success: true,
      messages: messages.rows
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// POST /api/chat/send - Send a message
router.post("/api/chat/send", isAuthenticated, async (req, res) => {
  const customerId = req.session.user.id;
  const { message } = req.body;
  
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  try {
    // Get or create conversation
    let convResult = await db.query(
      `SELECT id FROM chat_conversations 
       WHERE customer_id = $1 AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
      [customerId]
    );
    
    let conversationId;
    
    if (convResult.rows.length === 0) {
      const newConv = await db.query(
        `INSERT INTO chat_conversations (customer_id, status)
         VALUES ($1, 'active')
         RETURNING id`,
        [customerId]
      );
      conversationId = newConv.rows[0].id;
    } else {
      conversationId = convResult.rows[0].id;
    }
    
    // Insert message
    const msgResult = await db.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, sender_type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [conversationId, customerId, 'customer', message.trim()]
    );
    
    // Update conversation timestamp
    await db.query(
      `UPDATE chat_conversations 
       SET updated_at = NOW(), last_message_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );
    
    // Notify all admins
    try {
      const adminUsers = await db.query(
        "SELECT id FROM customers WHERE role = 'admin'"
      );
      
      for (const admin of adminUsers.rows) {
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link, type) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            admin.id,
            'New Chat Message',
            `Customer sent a message: ${message.trim().substring(0, 50)}${message.length > 50 ? '...' : ''}`,
            `/admin/chat`,
            'chat'
          ]
        );
      }
    } catch (notifErr) {
      console.warn('Could not create admin notification:', notifErr.message);
    }
    
    res.json({
      success: true,
      messageId: msgResult.rows[0].id,
      timestamp: msgResult.rows[0].created_at
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

/* ==============================
   ADMIN CHAT ENDPOINTS
============================== */

// GET /admin/chat - Admin chat dashboard
router.get("/admin/chat", isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get all conversations
    const conversations = await db.query(
      `SELECT c.*,
              cu.first_name as customer_first_name,
              cu.last_name as customer_last_name,
              cu.email as customer_email,
              a.first_name as admin_first_name,
              a.last_name as admin_last_name,
              (SELECT COUNT(*) FROM chat_messages 
               WHERE conversation_id = c.id 
               AND sender_type = 'customer' 
               AND is_read = FALSE) as unread_count,
              (SELECT message FROM chat_messages 
               WHERE conversation_id = c.id 
               ORDER BY created_at DESC LIMIT 1) as last_message
       FROM chat_conversations c
       JOIN customers cu ON c.customer_id = cu.id
       LEFT JOIN customers a ON c.admin_id = a.id
       WHERE c.status = 'active'
       ORDER BY c.last_message_at DESC`,
      []
    );
    
    res.render("admin/adminchat", {
      user: req.session.user,
      conversations: conversations.rows
    });
  } catch (error) {
    console.error('Error loading admin chat:', error);
    res.status(500).send('Error loading chat');
  }
});

// GET /admin/chat/:id - Get messages for a specific conversation
router.get("/admin/chat/:id/messages", isAuthenticated, isAdmin, async (req, res) => {
  const conversationId = req.params.id;
  
  try {
    const messages = await db.query(
      `SELECT m.*, 
              c.first_name, 
              c.last_name,
              c.role
       FROM chat_messages m
       JOIN customers c ON m.sender_id = c.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );
    
    // Mark customer messages as read
    await db.query(
      `UPDATE chat_messages 
       SET is_read = TRUE 
       WHERE conversation_id = $1 
       AND sender_type = 'customer' 
       AND is_read = FALSE`,
      [conversationId]
    );
    
    res.json({
      success: true,
      messages: messages.rows
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// POST /admin/chat/:id/send - Admin sends message
router.post("/admin/chat/:id/send", isAuthenticated, isAdmin, async (req, res) => {
  const conversationId = req.params.id;
  const adminId = req.session.user.id;
  const { message } = req.body;
  
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  try {
    // Insert message
    const msgResult = await db.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, sender_type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [conversationId, adminId, 'admin', message.trim()]
    );
    
    // Update conversation
    await db.query(
      `UPDATE chat_conversations 
       SET updated_at = NOW(), 
           last_message_at = NOW(),
           admin_id = $2
       WHERE id = $1`,
      [conversationId, adminId]
    );
    
    // Get customer ID for notification
    const convResult = await db.query(
      `SELECT customer_id FROM chat_conversations WHERE id = $1`,
      [conversationId]
    );
    
    if (convResult.rows.length > 0) {
      const customerId = convResult.rows[0].customer_id;
      
      // Notify customer
      try {
        await db.query(
          `INSERT INTO user_notifications (user_id, title, body, link, type) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            customerId,
            'New Message from Support',
            message.trim().substring(0, 50) + (message.length > 50 ? '...' : ''),
            `/chat`,
            'chat'
          ]
        );
      } catch (notifErr) {
        console.warn('Could not create customer notification:', notifErr.message);
      }
    }
    
    res.json({
      success: true,
      messageId: msgResult.rows[0].id,
      timestamp: msgResult.rows[0].created_at
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// POST /admin/chat/:id/close - Close conversation
router.post("/admin/chat/:id/close", isAuthenticated, isAdmin, async (req, res) => {
  const conversationId = req.params.id;
  
  try {
    await db.query(
      `UPDATE chat_conversations SET status = 'closed' WHERE id = $1`,
      [conversationId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error closing conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to close conversation' });
  }
});

export default router;
