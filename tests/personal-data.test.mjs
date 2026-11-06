import { db, request, createUser } from "./helpers/app.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as getBookmarks, POST as postBookmark, DELETE as deleteBookmark } from "@/app/api/watch/bookmarks/route";
import { GET as getTags, POST as postTag, DELETE as deleteTag } from "@/app/api/watch/tags/route";
import { GET as getFavs, POST as postFav, DELETE as deleteFav } from "@/app/api/categories/favorites/route";

const json = (res) => res.json();
const withBody = (path, method, body, cookie) => request(path, { method, body, cookie });

// ---------------------------------------------------------------- bookmarks
test("bookmarks require a session on every method", async () => {
  assert.equal((await getBookmarks(request("/api/watch/bookmarks"))).status, 401);
  assert.equal((await postBookmark(withBody("/api/watch/bookmarks", "POST", { vodId: "1", timestampSeconds: 5 }))).status, 401);
  assert.equal((await deleteBookmark(request("/api/watch/bookmarks?id=x", { method: "DELETE" }))).status, 401);
});

test("bookmarks: create, list in timestamp order, filter by VOD, delete", async () => {
  const u = await createUser();
  const add = (body) => postBookmark(withBody("/api/watch/bookmarks", "POST", body, u.cookie));
  assert.equal((await add({ vodId: "111", timestampSeconds: 300, note: "later", streamerLogin: "XQC" })).status, 200);
  assert.equal((await add({ vodId: "111", timestampSeconds: 60, note: "early" })).status, 200);
  assert.equal((await add({ vodId: "222", timestampSeconds: 10 })).status, 200);

  const all = (await json(await getBookmarks(request("/api/watch/bookmarks", { cookie: u.cookie })))).bookmarks;
  assert.equal(all.length, 3);
  const one = (await json(await getBookmarks(request("/api/watch/bookmarks?vodId=111", { cookie: u.cookie })))).bookmarks;
  assert.deepEqual(one.map((b) => b.timestampSeconds), [60, 300]);
  assert.equal(one[1].streamerLogin, "xqc");

  const del = await deleteBookmark(request(`/api/watch/bookmarks?id=${encodeURIComponent(one[0].id)}`, { method: "DELETE", cookie: u.cookie }));
  assert.equal(del.status, 200);
  const left = (await json(await getBookmarks(request("/api/watch/bookmarks?vodId=111", { cookie: u.cookie })))).bookmarks;
  assert.deepEqual(left.map((b) => b.timestampSeconds), [300]);
});

test("bookmarks: validation and sanitising", async () => {
  const u = await createUser();
  const add = (body) => postBookmark(withBody("/api/watch/bookmarks", "POST", body, u.cookie));
  assert.equal((await add({ vodId: "1" })).status, 400);
  assert.equal((await add({ timestampSeconds: 5 })).status, 400);
  const res = await add({ vodId: "12<x>3", timestampSeconds: -50.7, note: "<script>alert(1)</script>ok" });
  const bm = (await json(res)).bookmark;
  assert.equal(bm.vodId, "12x3");
  assert.equal(bm.timestampSeconds, 0); // negative clamps to 0
  assert.equal(bm.note.includes("<"), false);
  assert.equal((await deleteBookmark(request("/api/watch/bookmarks", { method: "DELETE", cookie: u.cookie }))).status, 400);
});

test("bookmarks: a user can neither see nor delete another user's bookmarks", async () => {
  const owner = await createUser();
  const other = await createUser();
  const created = (await json(await postBookmark(withBody("/api/watch/bookmarks", "POST", { vodId: "9", timestampSeconds: 1 }, owner.cookie)))).bookmark;

  assert.deepEqual((await json(await getBookmarks(request("/api/watch/bookmarks", { cookie: other.cookie })))).bookmarks, []);
  await deleteBookmark(request(`/api/watch/bookmarks?id=${encodeURIComponent(created.id)}`, { method: "DELETE", cookie: other.cookie }));
  assert.equal((await json(await getBookmarks(request("/api/watch/bookmarks", { cookie: owner.cookie })))).bookmarks.length, 1);
});

// ---------------------------------------------------------------- tags
test("tags require a session on every method", async () => {
  assert.equal((await getTags(request("/api/watch/tags"))).status, 401);
  assert.equal((await postTag(withBody("/api/watch/tags", "POST", { vodId: "1", tag: "x" }))).status, 401);
  assert.equal((await deleteTag(request("/api/watch/tags?vodId=1&tag=x", { method: "DELETE" }))).status, 401);
});

test("tags: add (lowercased, de-duplicated), list per VOD and overall, remove", async () => {
  const u = await createUser();
  const add = (vodId, tag) => postTag(withBody("/api/watch/tags", "POST", { vodId, tag }, u.cookie));
  assert.equal((await json(await add("1", "  Funny "))).tag, "funny");
  await add("1", "FUNNY"); // duplicate, ignored
  await add("1", "clip");
  await add("2", "clip");

  const forVod = (await json(await getTags(request("/api/watch/tags?vodId=1", { cookie: u.cookie })))).tags;
  assert.deepEqual(forVod, ["clip", "funny"]);
  const distinct = (await json(await getTags(request("/api/watch/tags", { cookie: u.cookie })))).tags;
  assert.deepEqual(distinct, ["clip", "funny"]);

  await deleteTag(request("/api/watch/tags?vodId=1&tag=Funny", { method: "DELETE", cookie: u.cookie }));
  assert.deepEqual((await json(await getTags(request("/api/watch/tags?vodId=1", { cookie: u.cookie })))).tags, ["clip"]);
});

test("tags: validation and per-user isolation", async () => {
  const a = await createUser();
  const b = await createUser();
  assert.equal((await postTag(withBody("/api/watch/tags", "POST", { vodId: "1" }, a.cookie))).status, 400);
  assert.equal((await postTag(withBody("/api/watch/tags", "POST", { vodId: "1", tag: "<>" }, a.cookie))).status, 400); // sanitises to nothing
  assert.equal((await deleteTag(request("/api/watch/tags?vodId=1", { method: "DELETE", cookie: a.cookie }))).status, 400);

  await postTag(withBody("/api/watch/tags", "POST", { vodId: "1", tag: "mine" }, a.cookie));
  assert.deepEqual((await json(await getTags(request("/api/watch/tags?vodId=1", { cookie: b.cookie })))).tags, []);
  await deleteTag(request("/api/watch/tags?vodId=1&tag=mine", { method: "DELETE", cookie: b.cookie }));
  assert.deepEqual((await json(await getTags(request("/api/watch/tags?vodId=1", { cookie: a.cookie })))).tags, ["mine"]);
});

// ---------------------------------------------------------------- favorite categories
test("favorites: anonymous GET is empty, writes need a session", async () => {
  assert.deepEqual(await json(await getFavs(request("/api/categories/favorites"))), { categories: [] });
  assert.equal((await postFav(withBody("/api/categories/favorites", "POST", { categoryName: "Dota 2" }))).status, 401);
  assert.equal((await deleteFav(request("/api/categories/favorites?categoryName=x", { method: "DELETE" }))).status, 401);
});

test("favorites: add, list, validate, remove (case-insensitive)", async () => {
  const u = await createUser();
  const add = (body) => postFav(withBody("/api/categories/favorites", "POST", body, u.cookie));
  assert.equal((await add({ categoryName: "Just Chatting", boxArtUrl: "https://static-cdn.jtvnw.net/x.jpg" })).status, 200);
  assert.equal((await add({ categoryName: "<script>" })).status, 400);
  assert.equal((await add({})).status, 400);

  const list = (await json(await getFavs(request("/api/categories/favorites", { cookie: u.cookie })))).categories;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Just Chatting");

  assert.equal((await deleteFav(request("/api/categories/favorites?categoryName=just%20chatting", { method: "DELETE", cookie: u.cookie }))).status, 200);
  assert.equal((await deleteFav(request("/api/categories/favorites?categoryName=just%20chatting", { method: "DELETE", cookie: u.cookie }))).status, 404);
  assert.equal((await deleteFav(request("/api/categories/favorites", { method: "DELETE", cookie: u.cookie }))).status, 400);
});

test("favorites: re-favoriting without art keeps the existing box art, and bad art URLs are dropped", async () => {
  const u = await createUser();
  const add = (body) => postFav(withBody("/api/categories/favorites", "POST", body, u.cookie));
  await add({ categoryName: "Art Cat", boxArtUrl: "https://static-cdn.jtvnw.net/art.jpg" });
  await add({ categoryName: "Art Cat" }); // no art this time
  const row = (await db.execute({ sql: "SELECT box_art_url FROM favorite_categories WHERE user_id = ?", args: [u.id] })).rows[0];
  assert.equal(row.box_art_url, "https://static-cdn.jtvnw.net/art.jpg");

  await add({ categoryName: "Evil Cat", boxArtUrl: "javascript:alert(1)" });
  const evil = (await db.execute({ sql: "SELECT box_art_url FROM favorite_categories WHERE user_id = ? AND category_name = 'Evil Cat'", args: [u.id] })).rows[0];
  assert.ok(!evil.box_art_url); // empty or null, never the script URL
});

test("favorites: users cannot remove each other's categories", async () => {
  const a = await createUser();
  const b = await createUser();
  await postFav(withBody("/api/categories/favorites", "POST", { categoryName: "Shared Name" }, a.cookie));
  assert.equal((await deleteFav(request("/api/categories/favorites?categoryName=Shared%20Name", { method: "DELETE", cookie: b.cookie }))).status, 404);
  assert.equal((await json(await getFavs(request("/api/categories/favorites", { cookie: a.cookie })))).categories.length, 1);
});
