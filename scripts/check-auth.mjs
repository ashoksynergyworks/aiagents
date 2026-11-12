import assert from "node:assert/strict";
process.env.AUTH_SECRET = "x".repeat(32);
const { addUser, checkPassword, createToken, hashPassword, verifyPassword, verifyToken } = await import("../app/auth.ts");

// bootstrap super admins resolve from code, without a database
assert.equal((await checkPassword("ashok.kumar@thesynergyworks.com", "Synergy#37"))?.role, "super_admin");
assert.equal((await checkPassword(" Shikha.Taman@thesynergyworks.com ", "Synergy#01"))?.role, "super_admin");
assert.equal(await checkPassword("ashok.kumar@thesynergyworks.com", "Synergy#01"), null);

// database users: stored hash round-trip; no user (undefined hash) never passes, even with the dummy's own password
const h = hashPassword("Temp-pass-1");
assert.equal(verifyPassword(h, "Temp-pass-1"), true);
assert.equal(verifyPassword(h, "temp-pass-1"), false);
assert.equal(verifyPassword(undefined, ""), false);
assert.equal(verifyPassword(undefined, "Synergy#37"), false);
assert.notEqual(hashPassword("same"), hashPassword("same")); // salted

// a super admin can't be created through addUser (refused before any database call)
assert.equal((await addUser("x@y.z", { email: "new@y.z", name: "New", role: "super_admin" })).error, "Super admins can't be added here.");

const t = createToken("ashok.kumar@thesynergyworks.com");
assert.equal(verifyToken(t), "ashok.kumar@thesynergyworks.com");
assert.equal(verifyToken(t.slice(0, -2) + "xx"), null); // bad signature
const forged = Buffer.from(`shikha.taman@thesynergyworks.com|${Date.now() + 1e6}`).toString("base64url");
assert.equal(verifyToken(`${forged}.${t.split(".")[1]}`), null); // swapped payload
const expired = Buffer.from(`ashok.kumar@thesynergyworks.com|${Date.now() - 1}`).toString("base64url");
assert.equal(verifyToken(`${expired}.${t.split(".")[1]}`), null);
assert.equal(verifyToken(""), null);
console.log("auth ok: passwords, case/space email, wrong password, db hash round-trip, no-user dummy, no super admin via addUser, signature, forged payload, expiry");
