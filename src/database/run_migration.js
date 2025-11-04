// Run database migration for PayPal capture ID
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false, // important for Supabase
  },
});

async function runMigration() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Run add_chat_system migration
    console.log('🔄 Running migration: add_chat_system...');
    const chatMigrationPath = join(__dirname, 'migrations', 'add_chat_system.sql');
    const chatSql = readFileSync(chatMigrationPath, 'utf8');
    await pool.query(chatSql);
    
    console.log('✅ Chat system migration completed successfully!');
    console.log('   - Created chat_conversations table');
    console.log('   - Created chat_messages table');
    console.log('   - Created indexes for better performance');
    console.log('   - Added foreign key constraints');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
