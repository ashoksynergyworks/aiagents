import assert from "node:assert/strict";
process.env.AUTH_SECRET = "x".repeat(32);
const { checkPassword, createToken, verifyToken } = await import("../app/auth.ts");

assert.equal(checkPassword("ashok.kumar@thesynergyworks.com", "Synergy#37")?.role, "super_admin");
assert.equal(checkPassword(" Shikha.Taman@thesynergyworks.com ", "Synergy#01")?.role, "super_admin");
assert.equal(checkPassword("ashok.kumar@thesynergyworks.com", "Synergy#01"), null);
assert.equal(checkPassword("nobody@x.com", "Synergy#37"), null);

const t = createToken("ashok.kumar@thesynergyworks.com");
assert.equal(verifyToken(t)?.email, "ashok.kumar@thesynergyworks.com");
assert.equal(verifyToken(t.slice(0, -2) + "xx"), null); // bad signature
const forged = Buffer.from(`shikha.taman@thesynergyworks.com|${Date.now() + 1e6}`).toString("base64url");
assert.equal(verifyToken(`${forged}.${t.split(".")[1]}`), null); // swapped payload
const expired = Buffer.from(`ashok.kumar@thesynergyworks.com|${Date.now() - 1}`).toString("base64url");
assert.equal(verifyToken(`${expired}.${t.split(".")[1]}`), null);
assert.equal(verifyToken(""), null);
console.log("auth ok: passwords, case/space email, wrong password, unknown user, signature, forged payload, expiry");
