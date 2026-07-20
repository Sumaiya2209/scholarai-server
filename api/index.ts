import dotenv from "dotenv";
dotenv.config();

import type { IncomingMessage, ServerResponse } from "http";
import type { Express } from "express";

import { connectDB, getMongoClientDb } from "../src/lib/db";
import { createAuth, setAuthInstance } from "../src/lib/auth";
import app from "../src/app";

// Vercel warm serverless instance-এর মধ্যে initialized app cache থাকবে।
let appPromise: Promise<Express> | null = null;

async function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      await connectDB();

      const auth = await createAuth(getMongoClientDb());
      setAuthInstance(auth);

      return app;
    })();
  }

  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const expressApp = await getApp();

  const url = new URL(req.url ?? "/", `https://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const search = url.search;

  let normalizedPath = pathname;
  if (pathname === "/") {
    normalizedPath = "/api/health";
  } else if (!pathname.startsWith("/api")) {
    normalizedPath = `/api${pathname}`;
  }

  req.url = `${normalizedPath}${search}`;
  expressApp(req, res);
}