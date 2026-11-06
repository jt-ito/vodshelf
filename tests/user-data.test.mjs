import { db, request, createUser, cookieFrom, asCookie, count } from "./helpers/app.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/user/settings/route";
import { PUT as changeUsername } from "@/app/api/user/username/route";
import { GET as exportData } from "@/app/api/user/export/route";
import { POST as importData } from "@/app/api/user/import/route";

const json = (res) => res.json();

// ---------------------------------------------------------------- settings
test("settings require a session", async () => {
  assert.equal((await getSettings(request("/api/user/settings"))).status, 401);
  assert.equal((await patchSettings(request("/api/user/settings", { method: "PATCH", body: { dateFormat: "exact" } }))).status, 401);
});

test("settings GET returns preferences, cooldown state and account stats", async () => {
  const u = await createUser();
  await db.batch([
    { sql: "INSERT INTO pinned_streamers (id, user_id, streamer_login) VALUES ('a', ?, 'xqc')", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched) VALUES ('w1', ?, '1', 'xqc', 1)", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched) VALUES ('w2', ?, '2', 'xqc', 0)", args: [u.id] },
  ]);
  const data = await json(await getSettings(request("/api/user/settings", { cookie: u.cookie })));
  assert.equal(data.user.id, u.id);
  assert.equal(data.user.dateFormat, "relative");
  assert.equal(data.user.canChangeUsername, true);
  assert.deepEqual(data.user.stats, { pinnedCount: 1, watchedCount: 1 }); // only watched VODs count
});

test("settings PATCH updates valid fields and coerces booleans", async () => {
  const u = await createUser();
  const patch = (body) => patchSettings(request("/api/user/settings", { method: "PATCH", body, cookie: u.cookie }));
  assert.equal((await patch({ dateFormat: "exact", markWatchedOnPlay: 1, markAllWatchedScope: "all" })).status, 200);
  const row = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [u.id] })).rows[0];
  assert.equal(row.date_format, "exact");
  assert.equal(row.mark_watched_on_play, 1);
  assert.equal(row.mark_all_watched_scope, "all");
  assert.equal(row.mark_watched_on_open_link, 0); // untouched
});

test("settings PATCH rejects invalid values and empty updates", async () => {
  const u = await createUser();
  const patch = (body) => patchSettings(request("/api/user/settings", { method: "PATCH", body, cookie: u.cookie }));
  assert.equal((await patch({ dateFormat: "weird" })).status, 400);
  assert.equal((await patch({ markAllWatchedScope: "everything" })).status, 400);
  assert.equal((await patch({})).status, 400);
  assert.equal((await patch({ unknownField: true })).status, 400);
});

test("settings PATCH cannot be used to inject SQL through field names", async () => {
  const u = await createUser();
  const res = await patchSettings(request("/api/user/settings", {
    method: "PATCH", cookie: u.cookie,
    body: { "date_format = 'x', password_hash": "pwned", dateFormat: "exact" },
  }));
  assert.equal(res.status, 200);
  const row = (await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [u.id] })).rows[0];
  assert.notEqual(row.password_hash, "pwned");
});

// ---------------------------------------------------------------- username
test("username change validates input and returns a session carrying the new name", async () => {
  const u = await createUser("rename_me");
  const put = (body, cookie = u.cookie) => changeUsername(request("/api/user/username", { method: "PUT", body, cookie }));

  assert.equal((await changeUsername(request("/api/user/username", { method: "PUT", body: { newUsername: "abc" } }))).status, 401);
  assert.equal((await put({ newUsername: "ab" })).status, 400);
  assert.equal((await put({ newUsername: "bad name" })).status, 400);
  assert.equal((await put({ newUsername: "RENAME_ME" })).status, 400); // same as current, ignoring case

  const ok = await put({ newUsername: "Renamed_User" });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).user.username, "renamed_user");
  assert.ok(cookieFrom(ok));
  const row = (await db.execute({ sql: "SELECT username, username_changed_at FROM users WHERE id = ?", args: [u.id] })).rows[0];
  assert.equal(row.username, "renamed_user");
  assert.ok(row.username_changed_at);
});

test("username changes are limited to one per 15 days", async () => {
  const u = await createUser("cooldown_user");
  const put = (newUsername) => changeUsername(request("/api/user/username", { method: "PUT", body: { newUsername }, cookie: u.cookie }));
  assert.equal((await put("first_change")).status, 200);

  const blocked = await put("second_change");
  assert.equal(blocked.status, 403);
  assert.ok((await json(blocked)).daysRemaining >= 14);

  // 16 days later the cooldown has passed
  const past = new Date(Date.now() - 16 * 24 * 3600_000).toISOString();
  await db.execute({ sql: "UPDATE users SET username_changed_at = ? WHERE id = ?", args: [past, u.id] });
  assert.equal((await put("second_change")).status, 200);
});

test("username change refuses a name that another account already has", async () => {
  await createUser("already_taken");
  const u = await createUser("wants_it");
  const res = await changeUsername(request("/api/user/username", { method: "PUT", body: { newUsername: "Already_Taken" }, cookie: u.cookie }));
  assert.equal(res.status, 409);
});

// ---------------------------------------------------------------- export / import
async function seedArchive(u) {
  await db.batch([
    { sql: "INSERT INTO pinned_streamers (id, user_id, streamer_login, streamer_display_name, group_name, is_hidden, sort_order) VALUES (?, ?, 'xqc', 'xQc', 'Favs', 1, 3)", args: [`p_${u.id}`, u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES (?, ?, '555', 'xqc', 1, 100, 100)", args: [`w_${u.id}`, u.id] },
    { sql: "INSERT INTO favorite_categories (id, user_id, category_name) VALUES (?, ?, 'Just Chatting')", args: [`f_${u.id}`, u.id] },
    { sql: "INSERT INTO bookmarks (id, user_id, vod_id, streamer_login, timestamp_seconds, note) VALUES (?, ?, '555', 'xqc', 90, 'funny part')", args: [`b_${u.id}`, u.id] },
    { sql: "INSERT INTO vod_tags (id, user_id, vod_id, tag) VALUES (?, ?, '555', 'clip')", args: [`t_${u.id}`, u.id] },
  ]);
}

test("export requires a session and contains only the caller's data", async () => {
  assert.equal((await exportData(request("/api/user/export"))).status, 401);

  const a = await createUser();
  const b = await createUser();
  await seedArchive(a);
  await db.execute({ sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login) VALUES ('other', ?, '999', 'zzz')", args: [b.id] });

  const res = await exportData(request("/api/user/export", { cookie: a.cookie }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="twitch_archive_backup_/);
  const data = await json(res);
  assert.equal(data.version, 1);
  assert.equal(data.pinnedStreamers.length, 1);
  assert.deepEqual(data.pinnedStreamers[0], {
    streamerLogin: "xqc", streamerDisplayName: "xQc", streamerAvatarUrl: null, groupName: "Favs", isHidden: true, sortOrder: 3,
  });
  assert.deepEqual(data.watchStatus.map((w) => w.vodId), ["555"]); // not b's vod 999
  assert.equal(data.bookmarks[0].note, "funny part");
  assert.equal(data.tags[0].tag, "clip");
  assert.equal(JSON.stringify(data).includes("password"), false);
});

test("an exported archive imports cleanly into another account", async () => {
  const a = await createUser();
  const b = await createUser();
  await seedArchive(a);
  const backup = await json(await exportData(request("/api/user/export", { cookie: a.cookie })));

  const res = await importData(request("/api/user/import", { method: "POST", body: backup, cookie: b.cookie }));
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).stats, { pinnedCount: 1, watchCount: 1, categoryCount: 1, bookmarkCount: 1, tagCount: 1 });
  for (const table of ["pinned_streamers", "watch_status", "favorite_categories", "bookmarks", "vod_tags"]) {
    assert.equal(await count(table, b.id), 1, table);
  }
});

test("import requires a session and a JSON object", async () => {
  assert.equal((await importData(request("/api/user/import", { method: "POST", body: {} }))).status, 401);
  const u = await createUser();
  assert.equal((await importData(request("/api/user/import", { method: "POST", body: "not json{", cookie: u.cookie }))).status, 400);
});

test("import binds every record to the caller and never touches other users", async () => {
  const attacker = await createUser();
  const victim = await createUser();
  await seedArchive(victim);

  const hostile = {
    pinnedStreamers: [{ streamerLogin: "evil", userId: victim.id, user_id: victim.id, id: `p_${victim.id}` }],
    watchStatus: [{ vodId: "555", streamerLogin: "xqc", userId: victim.id, user_id: victim.id, id: `w_${victim.id}`, isWatched: false }],
    bookmarks: [{ vodId: "555", timestampSeconds: 90, user_id: victim.id, id: `b_${victim.id}`, note: "hijack" }],
  };
  const res = await importData(request("/api/user/import", { method: "POST", body: hostile, cookie: attacker.cookie }));
  assert.equal(res.status, 200);

  // the victim's rows are exactly as seeded
  const w = (await db.execute({ sql: "SELECT is_watched FROM watch_status WHERE user_id = ? AND vod_id = '555'", args: [victim.id] })).rows;
  assert.equal(w.length, 1);
  assert.equal(w[0].is_watched, 1);
  assert.equal((await db.execute({ sql: "SELECT note FROM bookmarks WHERE user_id = ?", args: [victim.id] })).rows[0].note, "funny part");
  assert.equal((await db.execute({ sql: "SELECT COUNT(*) AS n FROM pinned_streamers WHERE user_id = ? AND streamer_login = 'evil'", args: [victim.id] })).rows[0].n, 0);
  // and the attacker only got rows under their own id
  assert.equal(await count("pinned_streamers", attacker.id), 1);
});

test("import sanitises text, ids and logins and skips unusable entries", async () => {
  const u = await createUser();
  const payload = {
    pinnedStreamers: [
      { streamerLogin: "Good_One", streamerDisplayName: "<b>Bold</b> \"name\"", groupName: "<script>x</script>Grp" },
      { streamerLogin: "../../etc/passwd" }, // invalid login: skipped
      { streamerLogin: "" },
    ],
    bookmarks: [{ vodId: "12<script>3", timestampSeconds: 10.9, note: "<img src=x onerror=alert(1)> hi" }],
    tags: [{ vodId: "123", tag: "<B>LOUD</B>" }, { vodId: "123", tag: "" }],
  };
  const res = await importData(request("/api/user/import", { method: "POST", body: payload, cookie: u.cookie }));
  assert.equal(res.status, 200);

  const pins = (await db.execute({ sql: "SELECT streamer_login, streamer_display_name, group_name FROM pinned_streamers WHERE user_id = ?", args: [u.id] })).rows;
  assert.equal(pins.length, 1);
  assert.equal(pins[0].streamer_login, "good_one");
  assert.equal(pins[0].streamer_display_name, "Bold name");
  assert.equal(pins[0].group_name, "xGrp");

  const bm = (await db.execute({ sql: "SELECT vod_id, timestamp_seconds, note FROM bookmarks WHERE user_id = ?", args: [u.id] })).rows[0];
  assert.equal(bm.vod_id, "12script3"); // markup characters stripped from the id
  assert.equal(bm.timestamp_seconds, 10);
  assert.equal(bm.note.includes("<"), false);
  assert.equal(bm.note.includes("onerror"), false);

  assert.deepEqual((await db.execute({ sql: "SELECT tag FROM vod_tags WHERE user_id = ?", args: [u.id] })).rows.map((r) => r.tag), ["loud"]);
});

test("import skips watch entries without a valid streamer instead of failing the whole restore", async () => {
  const u = await createUser();
  const res = await importData(request("/api/user/import", {
    method: "POST", cookie: u.cookie,
    body: { watchStatus: [{ vodId: "1" }, { vodId: "2", streamerLogin: "xqc", isWatched: true }] },
  }));
  assert.equal(res.status, 200);
  assert.equal(await count("watch_status", u.id), 1);
});

test("import only stores http(s) avatar and box-art URLs", async () => {
  const u = await createUser();
  await importData(request("/api/user/import", {
    method: "POST", cookie: u.cookie,
    body: {
      pinnedStreamers: [
        { streamerLogin: "safe_one", streamerAvatarUrl: "https://static-cdn.jtvnw.net/a.png" },
        { streamerLogin: "evil_one", streamerAvatarUrl: "javascript:alert(1)" },
      ],
      favoriteCategories: [{ categoryName: "Cat", boxArtUrl: "javascript:alert(1)" }],
    },
  }));
  const pins = Object.fromEntries(
    (await db.execute({ sql: "SELECT streamer_login, streamer_avatar_url FROM pinned_streamers WHERE user_id = ?", args: [u.id] })).rows
      .map((r) => [r.streamer_login, r.streamer_avatar_url])
  );
  assert.equal(pins.safe_one, "https://static-cdn.jtvnw.net/a.png");
  assert.equal(pins.evil_one, null);
  assert.equal((await db.execute({ sql: "SELECT box_art_url FROM favorite_categories WHERE user_id = ?", args: [u.id] })).rows[0].box_art_url, null);
});

test("import restores valid settings and ignores invalid ones", async () => {
  const u = await createUser();
  await importData(request("/api/user/import", {
    method: "POST", cookie: u.cookie,
    body: { user: { settings: { dateFormat: "exact", markWatchedOnPlay: true, markAllWatchedScope: "bogus", markWatchedOnOpenLink: "yes" } } },
  }));
  const row = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [u.id] })).rows[0];
  assert.equal(row.date_format, "exact");
  assert.equal(row.mark_watched_on_play, 1);
  assert.equal(row.mark_all_watched_scope, "loaded"); // bogus scope ignored
  assert.equal(row.mark_watched_on_open_link, 0); // non-boolean ignored
});
