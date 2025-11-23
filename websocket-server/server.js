import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import amqp from "amqplib";
import pg from "pg";
import crypto from "crypto";

const wss = new WebSocketServer({ port: 4000 });

const pool = new pg.Pool({
  host: process.env.DB_HOST || "postgres",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "admin",
  database: process.env.DB_NAME || "chatdb",
  port: Number(process.env.DB_PORT) || 5432
});

const clients = new Map();
const roomSubscriptions = new Map();

let channel;
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://rabbitmq:5672";
const RETRY_DELAY_MS = 3000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashAccessCode = (code = "") =>
  crypto.createHash("sha256").update(code).digest("hex");

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function subscribeClientToRoom(ws, roomId) {
  const info = clients.get(ws);
  if (!info) return;

  if (info.rooms.has(roomId)) {
    return;
  }

  info.rooms.add(roomId);

  if (!roomSubscriptions.has(roomId)) {
    roomSubscriptions.set(roomId, new Set());
  }

  roomSubscriptions.get(roomId).add(ws);
}

function cleanupClient(ws) {
  const info = clients.get(ws);
  if (!info) {
    return;
  }

  info.rooms.forEach((roomId) => {
    const subscribers = roomSubscriptions.get(roomId);
    if (subscribers) {
      subscribers.delete(ws);
      if (!subscribers.size) {
        roomSubscriptions.delete(roomId);
      }
    }
  });

  clients.delete(ws);
}

function broadcastToRoom(roomId, payload, excludeWs) {
  const subscribers = roomSubscriptions.get(roomId);
  if (!subscribers) {
    return;
  }

  const message = JSON.stringify(payload);
  subscribers.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(message);
    }
  });
}

async function getRoomWithMemberFlag(roomId, userId) {
  const result = await pool.query(
    `
      SELECT
        r.id,
        r.name,
        r.is_private,
        r.access_code,
        r.owner_id,
        EXISTS (
          SELECT 1 FROM room_members rm
          WHERE rm.room_id = r.id AND rm.user_id = $2
        ) AS is_member
      FROM rooms r
      WHERE r.id = $1
    `,
    [roomId, userId]
  );

  return result.rows[0];
}

async function userHasRoomAccess(userId, roomId) {
  const result = await pool.query(
    `
      SELECT CASE
        WHEN r.is_private = FALSE THEN TRUE
        WHEN r.owner_id = $2 THEN TRUE
        WHEN EXISTS (
          SELECT 1 FROM room_members rm
          WHERE rm.room_id = r.id AND rm.user_id = $2
        ) THEN TRUE
        ELSE FALSE
      END AS has_access
      FROM rooms r
      WHERE r.id = $1
    `,
    [roomId, userId]
  );

  return result.rows[0]?.has_access || false;
}

async function joinRoom(ws, user, payload) {
  const roomId = Number(payload.roomId);
  const { accessCode } = payload;

  if (!Number.isInteger(roomId)) {
    safeSend(ws, { type: "error", roomId, message: "Sala inválida." });
    return;
  }

  try {
    const room = await getRoomWithMemberFlag(roomId, user.id);

    if (!room) {
      safeSend(ws, { type: "error", roomId, message: "La sala no existe." });
      return;
    }

    if (
      room.is_private &&
      !room.is_member &&
      room.owner_id !== user.id
    ) {
      if (!accessCode || hashAccessCode(accessCode) !== room.access_code) {
        safeSend(ws, {
          type: "error",
          roomId,
          message: "Código de acceso inválido."
        });
        return;
      }
    }

    if (!room.is_member) {
      await pool.query(
        `
          INSERT INTO room_members (room_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [roomId, user.id]
      );
    }

    subscribeClientToRoom(ws, roomId);

    safeSend(ws, {
      type: "room_joined",
      roomId,
      room: { id: room.id, name: room.name, isPrivate: room.is_private }
    });

    broadcastToRoom(
      roomId,
      {
        type: "user_joined",
        roomId,
        user: { id: user.id, username: user.username }
      },
      ws
    );
  } catch (error) {
    console.error("Error uniendo a sala:", error);
    safeSend(ws, {
      type: "error",
      roomId,
      message: "No se pudo unir a la sala."
    });
  }
}

async function handleRoomMessage(ws, user, payload) {
  const roomId = Number(payload.roomId);
  const content = (payload.content || "").trim();

  if (!Number.isInteger(roomId) || !content) {
    safeSend(ws, { type: "error", roomId, message: "Mensaje inválido." });
    return;
  }

  if (!channel) {
    safeSend(ws, {
      type: "error",
      roomId,
      message: "RabbitMQ no está disponible."
    });
    return;
  }

  const info = clients.get(ws);
  const isLocalMember = info?.rooms.has(roomId);

  try {
    if (!isLocalMember) {
      const hasAccess = await userHasRoomAccess(user.id, roomId);
      if (!hasAccess) {
        safeSend(ws, { type: "error", roomId, message: "Sin acceso a la sala." });
        return;
      }
      subscribeClientToRoom(ws, roomId);
    }

    const result = await pool.query(
      `
        INSERT INTO messages (room_id, user_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, timestamp
      `,
      [roomId, user.id, content]
    );

    const messagePayload = {
      type: "message",
      id: result.rows[0].id,
      roomId,
      user: { id: user.id, username: user.username },
      content,
      timestamp: result.rows[0].timestamp
    };

    channel.publish(
      "chat.exchange",
      `room.${roomId}.message`,
      Buffer.from(JSON.stringify(messagePayload))
    );

    safeSend(ws, { type: "sent", roomId, messageId: messagePayload.id });
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    safeSend(ws, {
      type: "error",
      roomId,
      message: "No se pudo enviar el mensaje."
    });
  }
}

// Conexion RabbitMQ
async function connectRabbitMQ() {
  while (true) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      connection.on("close", () => {
        console.warn("Conexión con RabbitMQ cerrada. Reintentando...");
        channel = null;
        connectRabbitMQ().catch((err) =>
          console.error("Fallo reintentando la conexión con RabbitMQ:", err)
        );
      });
      connection.on("error", (err) => {
        console.error("Error en la conexión con RabbitMQ:", err);
      });

      channel = await connection.createChannel();
      await channel.assertExchange("chat.exchange", "topic", { durable: false });

      console.log("WebSocket server conectado a RabbitMQ");

      const q = await channel.assertQueue("", { exclusive: true });
      await channel.bindQueue(q.queue, "chat.exchange", "room.*.message");

      channel.consume(
        q.queue,
        (msg) => {
          if (!msg) {
            return;
          }

          try {
            const content = JSON.parse(msg.content.toString());
            const roomId = Number(content.roomId);
            if (Number.isInteger(roomId)) {
              broadcastToRoom(roomId, content);
            }
          } catch (error) {
            console.error("Error procesando mensaje del broker:", error);
          }
        },
        { noAck: true }
      );

      break;
    } catch (err) {
      console.error(
        `Error conectando a RabbitMQ: ${err?.message || err}. Reintentando en 3 segundos...`
      );
      await delay(RETRY_DELAY_MS);
    }
  }
}

connectRabbitMQ().catch((err) =>
  console.error("Fallo inicial conectando a RabbitMQ:", err)
);

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

wss.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://localhost").searchParams.get("token");
  const user = verifyToken(token);

  if (!user) {
    ws.close(4401, "Token inválido");
    return;
  }

  clients.set(ws, { user, rooms: new Set() });

  safeSend(ws, {
    type: "connected",
    user: { id: user.id, username: user.username }
  });

  ws.on("message", async (raw) => {
    let payload;

    try {
      payload = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: "error", message: "Formato de mensaje inválido." });
      return;
    }

    switch (payload.type) {
      case "join":
        await joinRoom(ws, user, payload);
        break;
      case "message":
        await handleRoomMessage(ws, user, payload);
        break;
      default:
        safeSend(ws, { type: "error", message: "Tipo de mensaje no soportado." });
    }
  });

  ws.on("close", () => cleanupClient(ws));
  ws.on("error", (err) => {
    console.error("Error en el socket:", err);
    cleanupClient(ws);
  });
});

console.log("WebSocket server corriendo en ws://localhost:4000");
