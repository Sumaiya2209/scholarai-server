import dotenv from "dotenv";
dotenv.config();

import { connectDB, getMongoClientDb } from "./lib/db.js";
import { createAuth, setAuthInstance } from "./lib/auth.js";

async function main() {
  await connectDB();

  const { default: app } = await import("./app.js");

  const auth = await createAuth(getMongoClientDb());
  setAuthInstance(auth);
 
   const PORT = Number(process.env.PORT) || 5000;
   const server = app.listen(PORT, () => {
     console.log(`🚀 ScholarAI API running on http://localhost:${PORT}`);
   });

  server.on("error", (err: any) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Kill the process using that port or change PORT.`);
      process.exit(1);
    }
    console.error("Server error:", err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});