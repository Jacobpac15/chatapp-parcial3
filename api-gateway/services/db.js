import pg from "pg";

const pool = new pg.Pool({
  host: "postgres",        // 👈 nombre del contenedor en docker-compose
  user: "admin",
  password: "admin",
  database: "chatdb",
  port: 5432
});

export default pool;
