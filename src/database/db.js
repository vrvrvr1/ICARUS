import pkg from "pg";
import dotenv from "dotenv";

dotenv.config(); // load .env

const { Pool } = pkg;

const db = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
  ssl: {
    rejectUnauthorized: false, // important for Supabase
  },
});

db.query("SELECT 1").catch(err => {
  console.error("DB connection failed:", err);
  process.exit(1);
});

export default db;
