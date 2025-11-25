# Chat en Tiempo Real — Documento Técnico

Juan Diego Martínez 
Jacobo Pacheco
Ricardo Plazas

> Para ejecutar:
> Desde la ruta `chatapp-parcial3/api-gateway` correr:  
> ```
> docker compose up --build
> ```

## Proyecto
Aplicación de chat en tiempo real con WebSockets.

## Resumen
Diseño y documentación de una aplicación de chat en tiempo real que soporta:

- Salas públicas y privadas  
- Persistencia de mensajes en base de datos relacional  
- Historial paginable vía REST  
- Notificaciones en tiempo real  
- Control de acceso mediante autenticación JWT y permisos por sala  

---

# 1. Visión Arquitectónica General

## 1.1 Patrones Arquitectónicos Usados

- **Cliente-Servidor:** clientes web/móvil se conectan al backend.
- **Pub-Sub interno:** para propagar eventos entre instancias backend (Redis).
- **Repository / Gateway:** separación entre lógica y acceso a BD.
- **CQRS ligero:**  
  - Escritura en WebSocket  
  - Lectura vía REST  

---

# 2. Componentes

## 2.1 Componentes del Sistema

1. **Clientes:** Web (SPA) y móviles.  
   Conexión WebSocket para mensajes en tiempo real y REST para historial/gestión.

2. **API REST (Auth & Management):**  
   Autenticación, salas, invitaciones e historial paginado.

3. **Servidor WebSocket (Real-time Gateway):**  
   Valida JWT, enruta mensajes a salas, publica eventos.

4. **Broker interno (Redis Pub/Sub):**  
   Propagación de eventos entre múltiples instancias WebSocket.

5. **Base de datos relacional (Postgres/MySQL):**  
   Persistencia de usuarios, salas, membresías y mensajes.

## 2.2 Despliegue

- Varias réplicas WebSocket+REST detrás de balanceador compatible con WebSockets.
- Redis (cluster o managed).
- Postgres como servicio gestionado.

---

# 3. Decisiones Arquitectónicas (ADRs)

## ADR 001 — Protocolo de Transporte
- **Decisión:** WebSocket.  
- **Razón:** Baja latencia y bidireccionalidad.  
- **Contras:** Requiere balanceador compatible y manejo de escalado/pubsub.

## ADR 002 — Autenticación
- **Decisión:** JWT (firma, TTL corto + refresh).  
- **Uso:**  
  - REST: `Authorization: Bearer <jwt>`  
  - WS: query param, subprotocol o mensaje inicial  

## ADR 003 — Persistencia
- **Decisión:** Postgres  
- **Razón:** Integridad referencial + paginación sencilla

## ADR 004 — Sincronización Entre Instancias
- **Decisión:** Redis Pub/Sub  
- **Razón:** Baja latencia y simplicidad

---

# 4. Modelo de Datos (Postgres)

### DDL Resumido

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    access_code TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    room_id INT REFERENCES rooms(id),
    user_id INT REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

# 7. Flujos de Interacción

## 7.1 Conexión y Autenticación WebSocket

1. El cliente obtiene un JWT mediante el endpoint de autenticación.
2. El cliente abre la conexión WebSocket e incluye el token (query param, subprotocol o mensaje inicial).
3. El servidor valida el JWT y asocia la conexión al `user_id`.
4. El cliente envía un evento `join_room` para unirse a las salas deseadas.

## 7.2 Enviar Mensaje

1. El cliente envía un evento `message_send` por WebSocket.
2. El servidor valida permisos e inserta el mensaje en la base de datos.
3. El servidor publica un evento `room:{id}` en Redis Pub/Sub.
4. Todas las instancias WebSocket envían el mensaje a los usuarios conectados en esa sala.
5. El servidor responde al emisor con un evento de confirmación `ack`.

---

# 8. Escalado y Disponibilidad

- Escalado horizontal de múltiples instancias del servidor WebSocket.
- Sticky sessions opcionales (mejoran latencia, pero no son obligatorias gracias a Redis Pub/Sub).
- Particionado por `room_id` para grandes volúmenes de mensajes.
- Estrategia de backup y restauración para Postgres.

---

# 9. Observabilidad y Pruebas

## Métricas recomendadas
- Conexiones WebSocket activas.
- Mensajes por segundo.
- Latencia (envío, persistencia, entrega).
- Errores por tipo.

## Logs
- Formato JSON estructurado.
- Incluyen: conexiones, desconexiones, eventos clave, errores de autenticación y fallos en Pub/Sub.

## Tipos de pruebas

### Unitarias
- Validación de reglas de autorización.
- Validación de membresías y permisos por sala.

### Integración
- Flujo completo: WebSocket → BD → Redis → entrega por WebSocket.

### Pruebas de carga
- Simulación de miles de conexiones concurrentes.
- Envío masivo de mensajes por sala.

---

# 10. Migraciones, Mantenimiento y Roadmap

## MVP
- Autenticación JWT.
- Salas públicas.
- Mensajes persistidos.
- Historial paginado (REST).
- Notificaciones básicas de join/leave.
