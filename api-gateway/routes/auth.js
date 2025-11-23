// api-gateway/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../services/db.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_123";

// REGISTER - Crear usuario con contraseña
router.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos (mín. 3 y 4 caracteres)" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password) 
       VALUES ($1, $2) 
       RETURNING id, username`,
      [username.trim(), hashedPassword]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    console.error(err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// LOGIN - Con usuario y contraseña
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username.trim()]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

export default router;