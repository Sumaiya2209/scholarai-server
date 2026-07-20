import express from "express";
import cors from "cors";
import paperRoutes from "./routes/paper.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getAuthInstance, createAuth, setAuthInstance } from "./lib/auth.js";
import { connectDB, getMongoClientDb } from "./lib/db.js";
import mongoose from "mongoose";
import { Paper } from "./models/Paper.js";
import { User } from "./models/User.js";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.all("/api/auth/*", async (req, res) => {
  try {
    let auth;
    try {
      auth = getAuthInstance();
    } catch {
      await connectDB();
      const newAuth = await createAuth(getMongoClientDb());
      setAuthInstance(newAuth);
      auth = newAuth;
    }

    const { toNodeHandler } = await import("better-auth/node");
    const handler = toNodeHandler(auth);
    return handler(req, res);
  } catch (err) {
    console.error("Auth handler initialization failed:", err);
    return res.status(503).json({ message: "Auth not initialized" });
  }
});

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "ScholarAI API is running" });
});

// Debug endpoint to verify environment and DB state in production
app.get("/api/debug", async (_req, res) => {
  try {
    const dbState = mongoose.connection.readyState; // 0 = disconnected, 1 = connected
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || process.env.DATABASE_NAME || null;
    const [totalPapers, approvedPapers, pendingPapers, rejectedPapers, usersCount] = await Promise.all([
      Paper.countDocuments({}),
      Paper.countDocuments({ status: "approved" }),
      Paper.countDocuments({ status: "pending" }),
      Paper.countDocuments({ status: "rejected" }),
      User.countDocuments({}),
    ]);

    return res.json({
      status: "ok",
      env: {
        NODE_ENV: process.env.NODE_ENV,
        CLIENT_URL: process.env.CLIENT_URL || null,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || null,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || null,
      },
      db: { state: dbState, name: dbName },
      counts: { totalPapers, approvedPapers, pendingPapers, rejectedPapers, usersCount },
    });
  } catch (err) {
    return res.status(500).json({ status: "error", error: String(err) });
  }
});

app.use("/api/papers", paperRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chat", chatRoutes);

app.use(errorHandler);

export default app;