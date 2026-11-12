import { MongoClient } from "mongodb";

// ponytail: cached on globalThis so dev hot-reloads don't open a new pool each time
const g = globalThis as unknown as { mongo?: MongoClient };
export const mongo = (g.mongo ??= new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017/df-dev"));

// the app's own data (users, later workspaces); df-dev stays read-only
export async function appDb() {
  await mongo.connect(); // no-op when connected; revives a closed client
  return mongo.db(process.env.APP_DB || "prompt-kpi");
}
