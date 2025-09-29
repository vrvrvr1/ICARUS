import pkg from "pg";
const { Pool } = pkg;

const db = new Pool({
  user: "postgres",         // your PostgreSQL username
  host: "localhost",        // database host
  database: "icarus",       // your database name
  password: "1234",         // your PostgreSQL password
  port: 5432,               // default PostgreSQL port
});

export default db; // ✅ export db
