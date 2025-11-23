CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  is_private BOOLEAN DEFAULT FALSE,
  access_code TEXT,
  owner_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE room_members (
  room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  room_id INT REFERENCES rooms(id),
  user_id INT REFERENCES users(id),
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_room_timestamp ON messages(room_id, timestamp);
