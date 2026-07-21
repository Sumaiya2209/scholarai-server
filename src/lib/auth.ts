import type { Db } from "mongodb";

const clientOrigin = process.env.CLIENT_URL || "http://localhost:3000";
const authBaseUrl = process.env.BETTER_AUTH_URL || "http://localhost:5000";
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL === "1" ||
  (typeof process.env.BETTER_AUTH_URL === "string" && process.env.BETTER_AUTH_URL.includes("vercel.app"));

// Always include the hardcoded production URLs so auth works even if env
// vars are misconfigured on Vercel.
const PRODUCTION_FRONTEND = "https://scholarai-client.vercel.app";
const PRODUCTION_BACKEND = "https://scholarai-server.vercel.app";

// We create Better Auth AFTER mongoose connects (see server.ts), because it
// needs the raw MongoDB `Db` instance, not a mongoose connection.
export async function createAuth(db: Db) {
  const [{ betterAuth }, { mongodbAdapter }] = await Promise.all([
    import("better-auth"),
    import("better-auth/adapters/mongodb"),
  ]);

  const resolvedBaseURL = isProduction 
    ? "https://scholarai-client.vercel.app/api/auth" 
    : (process.env.BETTER_AUTH_URL || "http://localhost:3000/api/auth");
  console.log(`[Better Auth Init] isProduction=${isProduction}, baseURL=${resolvedBaseURL}, clientOrigin=${clientOrigin}`);

  return betterAuth({
    // The installed Better Auth Mongo adapter only accepts the db instance
    // and optional adapter config; the database name is taken from the db.
    database: mongodbAdapter(db),

    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: resolvedBaseURL,
    trustHost: true,

    trustedOrigins: [
      clientOrigin,
      authBaseUrl,
      PRODUCTION_FRONTEND,
      PRODUCTION_BACKEND,
      "https://scholarai-client.vercel.app",
      "https://scholarai-client.vercel.app/api/auth",
    ].filter(Boolean),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },

    socialProviders: {
      google: {
        enabled: true,
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },

    // Custom field on the User table: role -> "user" | "admin"
    // Every new signup defaults to "user". You'll manually flip one
    // account to "admin" directly in MongoDB (see README).
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false, // prevents users from setting their own role via signup payload
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once per day
    },

    advanced: {
      defaultCookieAttributes: {
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
      },
    },
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

// Simple singleton so middleware/controllers (loaded before Mongo connects)
// can still access the auth instance once it's ready.
let authInstance: Auth | null = null;

export function setAuthInstance(instance: Auth) {
  authInstance = instance;
}

export function getAuthInstance(): Auth {
  if (!authInstance) {
    throw new Error("Auth not initialized yet — connectDB() must run first");
  }
  return authInstance;
}
