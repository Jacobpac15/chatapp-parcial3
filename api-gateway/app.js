import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import roomsRoutes from "./routes/rooms.js";


const app = express();
app.use(cors());
app.use(express.json());

// Rutas
app.use("/auth", authRoutes);
app.use("/rooms", roomsRoutes);

app.listen(3000, () => {
  console.log("API Gateway running on http://localhost:3000");
});
