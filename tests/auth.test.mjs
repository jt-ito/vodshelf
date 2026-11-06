import { db, request, createUser, cookieFrom, asCookie, count } from "./helpers/app.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { PUT as changePassword } from "@/app/api/user/password/route";
import { DELETE as deleteAccount } from "@/app/api/user/route";

const json = (res) => res.json();
const post = (path, body, opts) => request(path, { method: "POST", body, ...opts });

test("register creates an account, hashes the password and sets an HttpOnly session cookie", async () => {
  const res = await register(post("/api/auth/register", { username: "Newbie_1", password: "s3cret-pass" }));
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.user.username, "newbie_1"); // normalised to lowercase
  assert.equal(data.user.markWatchedOnPlay, false);

  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.ok(cookieFrom(res));

  const row = (await db.execute("SELECT password_hash FROM users WHERE username = 'newbie_1'")).rows[0];
  assert.notEqual(row.password_hash, "s3cret-pass");
  assert.match(String(row.password_hash), /^\$2/);
});

test("register rejects invalid usernames and passwords with 400", async () => {
  for (const body of [
    { username: "ab", password: "longenough" },
    { username: "1starts", password: "longenough" },
    { username: "has space", password: "longenough" },
    { username: "<script>", password: "longenough" },
    { username: "validname", password: "short" },
    { username: "validname" },
    {},
  ]) {
    const res = await register(post("/api/auth/register", body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("register rejects a duplicate username, ignoring case, with 409", async () => {
  await register(post("/api/auth/register", { username: "dupname", password: "password1" }));
  const res = await register(post("/api/auth/register", { username: "DupName", password: "password2" }));
  assert.equal(res.status, 409);
});

test("register is rate limited per client", async () => {
  const ip = "203.0.113.10";
  let last;
  for (let i = 0; i < 9; i++) last = await register(post("/api/auth/register", {}, { ip }));
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) >= 1);
});

test("login succeeds with the right password and returns the user's settings", async () => {
  const u = await createUser("login_ok", { password: "right-pass-1", realHash: true });
  const res = await login(post("/api/auth/login", { username: "Login_OK", password: "right-pass-1" }));
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.user.id, u.id);
  assert.equal(data.user.dateFormat, "relative");
  assert.ok(cookieFrom(res));
});

test("login gives the same generic 401 for a wrong password, an unknown user and malformed input", async () => {
  await createUser("login_bad", { password: "right-pass-1", realHash: true });
  const responses = [
    await login(post("/api/auth/login", { username: "login_bad", password: "wrong-pass-1" })),
    await login(post("/api/auth/login", { username: "nobody_here", password: "whatever-1" })),
    await login(post("/api/auth/login", { username: "x", password: "y" })),
  ];
  const bodies = [];
  for (const r of responses) {
    assert.equal(r.status, 401);
    bodies.push(await json(r));
  }
  assert.equal(new Set(bodies.map((b) => b.error)).size, 1); // no user enumeration
  assert.equal(responses.some((r) => cookieFrom(r)), false);
});

test("login is rate limited per client", async () => {
  const ip = "203.0.113.20";
  let last;
  for (let i = 0; i < 16; i++) last = await login(post("/api/auth/login", { username: "ghost_user", password: "nope-nope" }, { ip }));
  assert.equal(last.status, 429);
});

test("me returns the signed-in user, or null for missing, forged and revoked sessions", async () => {
  const u = await createUser();
  const ok = await json(await me(request("/api/auth/me", { cookie: u.cookie })));
  assert.equal(ok.user.id, u.id);
  assert.equal((await json(await me(request("/api/auth/me")))).user, null);
  assert.equal((await json(await me(request("/api/auth/me", { cookie: asCookie("forged.token.value") })))).user, null);
});

test("logout revokes the session server-side and clears the cookie", async () => {
  const u = await createUser();
  const res = await logout(post("/api/auth/logout", undefined, { cookie: u.cookie }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/i);
  // the old token no longer works anywhere
  assert.equal((await json(await me(request("/api/auth/me", { cookie: u.cookie })))).user, null);
  // logging out with no session still succeeds and clears the cookie
  const anon = await logout(post("/api/auth/logout"));
  assert.equal(anon.status, 200);
  assert.match(anon.headers.get("set-cookie"), /Max-Age=0/i);
});

test("changing the password requires the current one, signs out other sessions and issues a fresh cookie", async () => {
  const u = await createUser("pw_change", { password: "old-password-1", realHash: true });
  const put = (body, cookie = u.cookie) => changePassword(request("/api/user/password", { method: "PUT", body, cookie }));

  assert.equal((await put({ currentPassword: "old-password-1", newPassword: "x" })).status, 400); // too short
  assert.equal((await put({ newPassword: "new-password-1" })).status, 400); // current missing
  assert.equal((await put({ currentPassword: "old-password-1", newPassword: "old-password-1" })).status, 400); // unchanged
  assert.equal((await put({ currentPassword: "WRONG-password", newPassword: "new-password-1" })).status, 401);
  assert.equal((await changePassword(request("/api/user/password", { method: "PUT", body: {} }))).status, 401);

  const ok = await put({ currentPassword: "old-password-1", newPassword: "new-password-1" });
  assert.equal(ok.status, 200);
  const freshCookie = asCookie(cookieFrom(ok));

  assert.equal((await json(await me(request("/api/auth/me", { cookie: u.cookie })))).user, null); // old session revoked
  assert.equal((await json(await me(request("/api/auth/me", { cookie: freshCookie })))).user.id, u.id);
  assert.equal((await login(post("/api/auth/login", { username: "pw_change", password: "new-password-1" }))).status, 200);
  assert.equal((await login(post("/api/auth/login", { username: "pw_change", password: "old-password-1" }))).status, 401);
});

test("deleting an account needs the password, removes only that user's data, and kills the session", async () => {
  const victim = await createUser("to_delete", { password: "delete-me-1", realHash: true });
  const bystander = await createUser("bystander");
  for (const u of [victim, bystander]) {
    await db.batch([
      { sql: "INSERT INTO pinned_streamers (id, user_id, streamer_login) VALUES (?, ?, 'xqc')", args: [`p_${u.id}`, u.id] },
      { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login) VALUES (?, ?, '1', 'xqc')", args: [`w_${u.id}`, u.id] },
      { sql: "INSERT INTO favorite_categories (id, user_id, category_name) VALUES (?, ?, 'Just Chatting')", args: [`f_${u.id}`, u.id] },
      { sql: "INSERT INTO bookmarks (id, user_id, vod_id, timestamp_seconds) VALUES (?, ?, '1', 5)", args: [`b_${u.id}`, u.id] },
      { sql: "INSERT INTO vod_tags (id, user_id, vod_id, tag) VALUES (?, ?, '1', 'x')", args: [`t_${u.id}`, u.id] },
    ]);
  }
  const del = (body, cookie = victim.cookie) => deleteAccount(request("/api/user", { method: "DELETE", body, cookie }));

  assert.equal((await deleteAccount(request("/api/user", { method: "DELETE", body: {} }))).status, 401);
  assert.equal((await del({})).status, 400);
  assert.equal((await del({ password: "not-the-password" })).status, 403);
  assert.equal(await count("watch_status", victim.id), 1); // untouched by the failed attempts

  const ok = await del({ password: "delete-me-1" });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie"), /Max-Age=0/i);

  for (const table of ["pinned_streamers", "watch_status", "favorite_categories", "bookmarks", "vod_tags"]) {
    assert.equal(await count(table, victim.id), 0, `${table} should be emptied`);
    assert.equal(await count(table, bystander.id), 1, `${table} of another user must survive`);
  }
  assert.equal((await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [victim.id] })).rows.length, 0);
  assert.equal((await json(await me(request("/api/auth/me", { cookie: victim.cookie })))).user, null);
});
