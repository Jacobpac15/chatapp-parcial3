import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import roomsRoutes from "./routes/rooms.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/rooms", roomsRoutes);

app.listen(3000, () => console.log("API en http://localhost:3000"));