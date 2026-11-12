import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "super_admin" | "admin" | "member";
export type User = { email: string; name: string; role: Role };

// ponytail: users live in code (scrypt "salt:hash", never plain passwords). Move to a DB collection when admins
// need to add users from the UI. New hash: node -e 'c=require("crypto");s=c.randomBytes(16).toString("hex");console.log(s+":"+c.scryptSync("PASSWORD",s,32).toString("hex"))'
const USERS: (User & { hash: string })[] = [
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

export const listUsers = (): User[] => USERS.map(({ email, name, role }) => ({ email, name, role }));

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

export function checkPassword(email: string, password: string): User | null {
  const u = USERS.find((x) => x.email === email.trim().toLowerCase());
  // hash a dummy when the email is unknown, so response time does not reveal which emails exist
  const [salt, hash] = (u?.hash ?? "00:00").split(":");
  const ok = safeEqual(scryptSync(password, salt, 32).toString("hex"), hash);
  return u && ok ? { email: u.email, name: u.name, role: u.role } : null;
}

// stateless token: base64url(email.expiry).signature
export function createToken(email: string) {
  const data = Buffer.from(`${email}|${Date.now() + MAX_AGE * 1000}`).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyToken(token = ""): User | null {
  const [data, sig] = token.split(".");
  if (!data || !sig || !safeEqual(sign(data), sig)) return null;
  const [email, exp] = Buffer.from(data, "base64url").toString().split("|");
  if (Number(exp) < Date.now()) return null;
  return listUsers().find((u) => u.email === email) ?? null; // a removed user loses access at once
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

export async function currentUser() {
  const { cookies } = await import("next/headers");
  return verifyToken((await cookies()).get(COOKIE)?.value);
}
