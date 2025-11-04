import db from './src/database/db.js';
import fs from 'fs';

(async () => {
  try {
    const sql = fs.readFileSync('./src/database/migrations/create_addresses_table.sql', 'utf8');
    await db.query(sql);
    console.log('✅ Addresses table migration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
})();
