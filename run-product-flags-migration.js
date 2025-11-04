import db from './src/database/db.js';
import fs from 'fs';

(async () => {
  try {
    const sql = fs.readFileSync('./src/database/migrations/add_product_status_flags.sql', 'utf8');
    await db.query(sql);
    console.log('✅ Product status flags migration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
})();
