import pg from "pg";
export const pool = new pg.Pool({
  host: "postgres",
  user: "admin",
  password: "admin",
  database: "chatdb",
  port: 5432
});