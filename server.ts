import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import { setupWebSocket } from "./src/socket.ts";
import { router } from "./src/routes.ts";
import dotenv from "dotenv";
dotenv.config();

const PORT = 3000;
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Mount API routes
app.use("/api", router);

// Serve frontend static assets from public/ directory
const staticDir = path.join(process.cwd(), "public");
app.use(express.static(staticDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// Setup Websockets
setupWebSocket(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 (PostgreSQL + Drizzle + Firebase) Server running on http://localhost:${PORT}`);
});
