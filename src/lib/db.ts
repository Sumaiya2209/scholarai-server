import mongoose from "mongoose";

// Cache the CONNECTION PROMISE (not just a boolean) so that concurrent
// requests hitting a cold serverless instance at the same time all await
// the same in-flight connect() call instead of racing to start their own —
// that race is what was causing "buffering timed out" errors on Vercel.
let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return; // already connected

  if (!connectionPromise) {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || process.env.DATABASE_NAME;
    if (!uri) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    const connectOptions: any = {
      serverSelectionTimeoutMS: 10000,
    };
    if (dbName) connectOptions.dbName = dbName;

    connectionPromise = mongoose
      .connect(uri, connectOptions)
      .then((m) => {
        console.log("✅ MongoDB connected");
        return m;
      })
      .catch((err) => {
        connectionPromise = null; // allow the next request to retry instead of staying broken forever
        console.error("❌ MongoDB connection failed:", err);
        throw err;
      });
  }

  await connectionPromise;
}

export function getMongoClientDb() {
  const client = mongoose.connection.getClient();
  const dbName =
    process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || process.env.DATABASE_NAME;
  return dbName ? client.db(dbName) : client.db();
}