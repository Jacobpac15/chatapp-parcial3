import express from "express";
import jwt from "jsonwebtoken";
import pool from "../services/db.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

router.post("/login", async (req, res) => {
  const { username } = req.body;

  if (!username || username.trim().length < 3) {
    return res.status(400).json({ error: "El nombre de usuario es obligatorio." });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO users (username)
        VALUES ($1)
        ON CONFLICT (username)
        DO UPDATE SET username = EXCLUDED.username
        RETURNING id, username
      `,
      [username.trim()]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({ token, user });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

export default router;
