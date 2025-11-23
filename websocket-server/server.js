// websocket-server/server.js → 100% FUNCIONAL (copia-pega completo)
import { WebSocketServer, WebSocket } from "ws";  // AÑADÍ WebSocket AQUÍ
import jwt from "jsonwebtoken";
import pg from "pg";
import crypto from "crypto";

const wss = new WebSocketServer({ port: 4000 });
const clients = new Map();      // ws → {user, rooms: Set}
const roomClients = new Map();  // roomId → Set de ws

const pool = new pg.Pool({
  host: "postgres",
  user: "admin",
  password: "admin",
  database: "chatdb",
  port: 5432
});

const JWT_SECRET = "supersecret123";

function hashCode(code) {
  return code ? crypto.createHash("sha256").update(code.trim()).digest("hex") : null;
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  
  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    ws.close(4001, "Token inválido");
    return;
  }

  clients.set(ws, { user, rooms: new Set() });
  ws.send(JSON.stringify({ type: "connected", message: "Conectado al servidor" }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "join") {
        const roomId = Number(msg.roomId);
        const code = msg.accessCode || "";

        const roomRes = await pool.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
        if (roomRes.rows.length === 0) {
          return ws.send(JSON.stringify({ type: "error", message: "Sala no existe" }));
        }

        const room = roomRes.rows[0];

        if (room.is_private && hashCode(code) !== room.access_code) {
          return ws.send(JSON.stringify({ type: "error", message: "Código incorrecto" }));
        }

        clients.get(ws).rooms.add(roomId);
        if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
        roomClients.get(roomId).add(ws);

        ws.send(JSON.stringify({ type: "joined", roomId, name: room.name }));

        broadcast(roomId, {
          type: "notification",
          message: `${user.username} entró a la sala`
        }, ws);
      }

      if (msg.type === "message" && msg.content?.trim()) {
        const roomId = Number(msg.roomId);
        const content = msg.content.trim();

        if (!clients.get(ws).rooms.has(roomId)) return;

        await pool.query(
          "INSERT INTO messages(room_id, user_id, content) VALUES($1,$2,$3)",
          [roomId, user.id, content]
        );

        broadcast(roomId, {
          type: "message",
          username: user.username,
          content: content
        });
      }
    } catch (e) {
      console.error("Error procesando mensaje:", e);
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    if (!info) return;

    info.rooms.forEach(roomId => {
      const set = roomClients.get(roomId);
      if (set) {
        set.delete(ws);
        broadcast(roomId, { type: "notification", message: `${info.user.username} salió` });
      }
    });
    clients.delete(ws);
  });
});

function broadcast(roomId, payload, exclude = null) {
  const payloadStr = JSON.stringify(payload);
  const clientsInRoom = roomClients.get(roomId) || new Set();
  
  clientsInRoom.forEach(client => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {  // YA FUNCIONA
      client.send(payloadStr);
    }
  });
}

console.log("WebSocket server corriendo en ws://localhost:4000");