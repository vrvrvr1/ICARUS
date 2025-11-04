-- Migration: Add live chat system
-- Description: Add tables for live chat between customers and admins

-- Create chat_conversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  admin_id INTEGER,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_chat_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_admin FOREIGN KEY (admin_id) REFERENCES customers(id) ON DELETE SET NULL
);

COMMENT ON TABLE chat_conversations IS 'Chat conversations between customers and admins';
COMMENT ON COLUMN chat_conversations.status IS 'active, closed, archived';
COMMENT ON COLUMN chat_conversations.admin_id IS 'Admin assigned to this conversation';

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  sender_type VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_message_conversation FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES customers(id) ON DELETE CASCADE
);

COMMENT ON TABLE chat_messages IS 'Individual chat messages in conversations';
COMMENT ON COLUMN chat_messages.sender_type IS 'customer or admin';
COMMENT ON COLUMN chat_messages.is_read IS 'Whether the message has been read by recipient';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_conversations_customer ON chat_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_admin ON chat_conversations(admin_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON chat_conversations(status);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(is_read) WHERE is_read = FALSE;

SELECT 'Chat system migration completed successfully!' AS result;
