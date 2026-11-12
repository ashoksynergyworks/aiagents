import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "super_admin" | "admin" | "member";
export type User = { email: string; name: string; role: Role };
type Stored = User & { hash: string };

// ponytail: the super admins live in code, so nobody can be locked out and no seed script is needed. Everyone else is
// in the "users" collection (added from /users). New hash: node -e 'c=require("crypto");s=c.randomBytes(16).toString("hex");console.log(s+":"+c.scryptSync("PASSWORD",s,32).toString("hex"))'
const BOOTSTRAP: Stored[] = [
  {
    email: "ashok.kumar@thesynergyworks.com",
    name: "Ashok Kumar",
    role: "super_admin",
    hash: "8d221ae093fc958e507499cc1859ff7e:a23eb6b98834a6cb09a6da2b5f38a67e643c82471ccc82b8c6d589b348cba4c9",
  },
  {
    email: "shikha.taman@thesynergyworks.com",
    name: "Shikha Taman",
    role: "super_admin",
    hash: "b849b634e827713be3a4251758854e7d:240cc4d03f07749128ad3eb988f19d70038025c3a9edfb7e447b2464699bbcd5",
  },
];

const pub = ({ email, name, role }: Stored): User => ({ email, name, role });
export const normEmail = (e: string) => e.trim().toLowerCase();

// lazy: keeps this file loadable by plain node (scripts/check-auth.mjs) and keeps mongodb out of proxy.ts
const users = async () => (await (await import("./db")).appDb()).collection<Stored & { createdBy: string; createdAt: Date }>("users");

async function findUser(email: string): Promise<Stored | null> {
  const e = normEmail(email);
  return BOOTSTRAP.find((u) => u.email === e) ?? (await (await users()).findOne({ email: e }, { projection: { _id: 0 } }));
}

export async function listUsers(): Promise<User[]> {
  const rest = await (await users()).find({}, { projection: { _id: 0, hash: 0 } }).sort({ createdAt: 1 }).toArray();
  return [...BOOTSTRAP, ...rest].map(pub);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export const COOKIE = "session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Set AUTH_SECRET (32+ chars) in .env, then restart the server.");
  return s;
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// hashes a dummy when there is no user, so response time does not reveal which emails exist
export function verifyPassword(stored: string | undefined, password: string) {
  const [salt, hash] = (stored ?? "00:00").split(":");
  return safeEqual(scryptSync(password, salt, 32).toString("hex"), hash) && !!stored;
}

export async function checkPassword(email: string, password: string): Promise<User | null> {
  const u = await findUser(email);
  return verifyPassword(u?.hash, password) && u ? pub(u) : null;
}

// Super admins only (checked by the caller). Returns the one-time temporary password.
// Super admins exist only in BOOTSTRAP: refused here, so no route or API can create one.
export async function addUser(by: string, input: { email: string; name: string; role: Exclude<Role, "super_admin"> }) {
  if ((input.role as Role) === "super_admin") return { error: "Super admins can't be added here." };
  const email = normEmail(input.email);
  if (BOOTSTRAP.some((u) => u.email === email)) return { error: "This person already has an account." };
  const password = randomBytes(9).toString("base64url"); // 12 characters
  const col = await users();
  await col.createIndex({ email: 1 }, { unique: true }); // no-op after the first call
  try {
    await col.insertOne({ email, name: input.name.trim(), role: input.role, hash: hashPassword(password), createdBy: by, createdAt: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { error: "This person already has an account." };
    throw e;
  }
  return { password };
}

// stateless token: base64url(email|expiry).signature
export function createToken(email: string) {
  const data = Buffer.from(`${email}|${Date.now() + MAX_AGE * 1000}`).toString("base64url");
  return `${data}.${sign(data)}`;
}

// Signature and expiry only (fast, no DB): proxy.ts gates every request with this.
export function verifyToken(token = ""): string | null {
  const [data, sig] = token.split(".");
  if (!data || !sig || !safeEqual(sign(data), sig)) return null;
  const [email, exp] = Buffer.from(data, "base64url").toString().split("|");
  return Number(exp) < Date.now() ? null : email;
}

export async function setSession(email: string) {
  const { cookies } = await import("next/headers"); // lazy: keeps this file loadable by plain node (scripts/check-auth.mjs)
  (await cookies()).set(COOKIE, createToken(email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

// Reads the user record on each call, so a removed user loses access at once
export async function currentUser() {
  const [{ cookies }, { connection }] = await Promise.all([import("next/headers"), import("next/server")]);
  await connection(); // per request: the expiry check reads Date.now(), which may not run while prerendering
  const email = verifyToken((await cookies()).get(COOKIE)?.value);
  const u = email ? await findUser(email) : null;
  return u ? pub(u) : null;
}
