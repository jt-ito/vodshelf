import { db, request, createUser, asCookie } from "./helpers/app.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  hashPassword, verifyPassword, createSessionToken, verifySessionToken, getCurrentUser, revokeUserSessions,
} from "@/lib/auth/session";

const secret = (s = process.env.JWT_SECRET) => new TextEncoder().encode(s);
const sign = (claims, { key = secret(), exp = "1h" } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(exp).sign(key);

test("passwords are hashed with bcrypt and verify correctly", async () => {
  const hash = await hashPassword("correct horse");
  assert.notEqual(hash, "correct horse");
  assert.match(hash, /^\$2[aby]\$12\$/); // 12 salt rounds
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("a session token round-trips its claims", async () => {
  const token = await createSessionToken({ id: "u1", username: "alice", tokenVersion: 3 });
  assert.deepEqual(await verifySessionToken(token), { id: "u1", username: "alice", tokenVersion: 3 });
});

test("verifySessionToken rejects tampered, foreign-secret, expired and incomplete tokens", async () => {
  const good = await createSessionToken({ id: "u1", username: "alice" });
  const [h, p, s] = good.split(".");
  assert.equal(await verifySessionToken(`${h}.${p}x.${s}`), null); // tampered payload
  assert.equal(await verifySessionToken("not.a.jwt"), null);
  assert.equal(await verifySessionToken(await sign({ id: "u1", username: "a" }, { key: secret("another-secret-another-secret-12345") })), null);
  assert.equal(await verifySessionToken(await sign({ id: "u1", username: "a" }, { exp: Math.floor(Date.now() / 1000) - 10 })), null);
  assert.equal(await verifySessionToken(await sign({ username: "a" })), null); // no id
  assert.equal(await verifySessionToken(await sign({ id: "u1" })), null); // no username
});

test("a token without tokenVersion defaults to version 1", async () => {
  assert.equal((await verifySessionToken(await sign({ id: "u", username: "n" }))).tokenVersion, 1);
});

test("getCurrentUser accepts the cookie and the Authorization bearer header", async () => {
  const u = await createUser();
  assert.equal((await getCurrentUser(request("/x", { cookie: u.cookie }))).id, u.id);
  assert.equal((await getCurrentUser(request("/x", { headers: { authorization: `Bearer ${u.token}` } }))).id, u.id);
});

test("getCurrentUser returns null with no credentials, a bad token, or a deleted user", async () => {
  assert.equal(await getCurrentUser(request("/x")), null);
  assert.equal(await getCurrentUser(request("/x", { cookie: asCookie("garbage") })), null);
  const u = await createUser();
  await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [u.id] });
  assert.equal(await getCurrentUser(request("/x", { cookie: u.cookie })), null);
});

test("revokeUserSessions invalidates every existing token immediately", async () => {
  const u = await createUser();
  assert.ok(await getCurrentUser(request("/x", { cookie: u.cookie })));
  const newVersion = await revokeUserSessions(u.id);
  assert.equal(newVersion, 2);
  assert.equal(await getCurrentUser(request("/x", { cookie: u.cookie })), null);
  const fresh = await createSessionToken({ id: u.id, username: u.username, tokenVersion: newVersion });
  assert.ok(await getCurrentUser(request("/x", { cookie: asCookie(fresh) })));
});

test("a database failure surfaces as an error, not as 'signed out'", async () => {
  const u = await createUser();
  await db.execute("ALTER TABLE users RENAME TO users_gone");
  try {
    await assert.rejects(getCurrentUser(request("/x", { cookie: u.cookie })));
  } finally {
    await db.execute("ALTER TABLE users_gone RENAME TO users");
  }
  assert.ok(await getCurrentUser(request("/x", { cookie: u.cookie })));
});
