import express from "express";
import crypto from "crypto";
import pool from "../services/db.js";
import authenticate from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate);

const hashAccessCode = (code = "") =>
  crypto.createHash("sha256").update(code).digest("hex");

async function findRoom(roomId) {
  const result = await pool.query(
    "SELECT id, name, is_private, owner_id, access_code FROM rooms WHERE id = $1",
    [roomId]
  );
  return result.rows[0];
}

async function userHasRoomAccess(userId, room) {
  if (!room) return false;
  if (!room.is_private) return true;
  if (room.owner_id === userId) return true;

  const membership = await pool.query(
    "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
    [room.id, userId]
  );
  return membership.rowCount > 0;
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          r.id,
          r.name,
          r.is_private,
          r.owner_id,
          EXISTS (
            SELECT 1 FROM room_members rm
            WHERE rm.room_id = r.id AND rm.user_id = $1
          ) OR r.owner_id = $1 AS is_member
        FROM rooms r
        WHERE r.is_private = FALSE
          OR r.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM room_members rm
            WHERE rm.room_id = r.id AND rm.user_id = $1
          )
        ORDER BY r.name ASC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error listando salas:", error);
    res.status(500).json({ error: "No se pudieron listar las salas" });
  }
});

router.get("/discover", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          r.id,
          r.name,
          r.is_private,
          r.owner_id,
          CASE
            WHEN r.owner_id = $1 THEN TRUE
            WHEN EXISTS (
              SELECT 1 FROM room_members rm
              WHERE rm.room_id = r.id AND rm.user_id = $1
            ) THEN TRUE
            ELSE FALSE
          END AS is_member
        FROM rooms r
        ORDER BY r.created_at DESC, r.name ASC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error listando salas (discover):", error);
    res.status(500).json({ error: "No se pudieron listar las salas" });
  }
});

router.post("/", async (req, res) => {
  const { name, isPrivate = false, accessCode } = req.body;

  if (!name || name.trim().length < 3) {
    return res.status(400).json({ error: "El nombre de la sala es obligatorio." });
  }

  if (isPrivate && !accessCode) {
    return res.status(400).json({ error: "Las salas privadas requieren un código de acceso." });
  }

  try {
    const accessCodeHash = isPrivate ? hashAccessCode(accessCode) : null;

    const result = await pool.query(
      `
        INSERT INTO rooms (name, is_private, access_code, owner_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, is_private, owner_id
      `,
      [name.trim(), isPrivate, accessCodeHash, req.user.id]
    );

    const room = result.rows[0];

    if (isPrivate) {
      await pool.query(
        `
          INSERT INTO room_members (room_id, user_id, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT DO NOTHING
        `,
        [room.id, req.user.id]
      );
    }

    res.status(201).json(room);
  } catch (error) {
    console.error("Error creando sala:", error);
    res.status(500).json({ error: "No se pudo crear la sala" });
  }
});

router.post("/:roomId/join", async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { accessCode } = req.body;

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: "ID de sala inválido." });
  }

  try {
    const room = await findRoom(roomId);

    if (!room) {
      return res.status(404).json({ error: "Sala no encontrada." });
    }

    if (room.is_private) {
      if (!accessCode) {
        return res.status(403).json({ error: "Código de acceso requerido." });
      }

      if (room.access_code !== hashAccessCode(accessCode)) {
        return res.status(403).json({ error: "Código de acceso incorrecto." });
      }
    }

    await pool.query(
      `
        INSERT INTO room_members (room_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [room.id, req.user.id]
    );

    res.json({ message: "Ingreso a la sala exitoso." });
  } catch (error) {
    console.error("Error uniendo a sala:", error);
    res.status(500).json({ error: "No se pudo entrar a la sala" });
  }
});

router.get("/:roomId/messages", async (req, res) => {
  const roomId = Number(req.params.roomId);
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ error: "ID de sala inválido." });
  }

  try {
    const room = await findRoom(roomId);

    if (!room) {
      return res.status(404).json({ error: "Sala no encontrada." });
    }

    const hasAccess = await userHasRoomAccess(req.user.id, room);

    if (!hasAccess) {
      return res.status(403).json({ error: "Sin acceso a esta sala." });
    }

    const messagesResult = await pool.query(
      `
        SELECT m.id, m.content, m.timestamp, u.username
        FROM messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.room_id = $1
        ORDER BY m.timestamp DESC
        LIMIT $2 OFFSET $3
      `,
      [roomId, limit, offset]
    );

    const totalResult = await pool.query(
      "SELECT COUNT(*)::INT AS total FROM messages WHERE room_id = $1",
      [roomId]
    );

    res.json({
      data: messagesResult.rows,
      page,
      limit,
      total: totalResult.rows[0].total,
      totalPages: Math.ceil(totalResult.rows[0].total / limit)
    });
  } catch (error) {
    console.error("Error obteniendo historial:", error);
    res.status(500).json({ error: "No se pudo obtener el historial" });
  }
});

export default router;
