import express from "express";
import { pool } from "../services/db.js";
import crypto from "crypto";

const router = express.Router();

router.get("/", async (req, res) => {
  const result = await pool.query("SELECT id, name, is_private FROM rooms ORDER BY id");
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const { name, isPrivate, password } = req.body;
  const code = isPrivate && password ? crypto.createHash("sha256").update(password).digest("hex") : null;
  const result = await pool.query(
    "INSERT INTO rooms(name, is_private, access_code) VALUES($1,$2,$3) RETURNING id, name, is_private",
    [name, isPrivate || false, code]
  );
  res.json(result.rows[0]);
});

export default router;