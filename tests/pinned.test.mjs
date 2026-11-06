import { db, request, createUser, count, mockFetch, gqlUsers } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PATCH, DELETE } from "@/app/api/streamers/pinned/route";

const json = (res) => res.json();
const send = (method, body, cookie, path = "/api/streamers/pinned") => request(path, { method, body, cookie });
const pin = (cookie, body) => POST(send("POST", { displayName: "Name", avatarUrl: "https://static-cdn.jtvnw.net/a.png", ...body }, cookie));
const list = async (cookie) => (await json(await GET(request("/api/streamers/pinned", { cookie })))).streamers;

let restore;
beforeEach(() => {
  // Live-status lookups hit Twitch; answer them offline (nobody live unless a test says so)
  restore = mockFetch(() => gqlUsers());
});
afterEach(() => restore());

test("anonymous users get an empty list and cannot write", async () => {
  assert.deepEqual(await list(undefined), []);
  assert.equal((await POST(send("POST", { login: "xqc" }))).status, 401);
  assert.equal((await PATCH(send("PATCH", { login: "xqc", isHidden: true }))).status, 401);
  assert.equal((await DELETE(request("/api/streamers/pinned?login=xqc", { method: "DELETE" }))).status, 401);
});

test("pinning validates the login and stores a sanitised creator", async () => {
  const u = await createUser();
  assert.equal((await pin(u.cookie, { login: "bad login!" })).status, 400);
  assert.equal((await pin(u.cookie, {})).status, 400);

  const res = await pin(u.cookie, { login: "XQC", displayName: "<b>xQc</b>", groupName: "<i>Faves</i>" });
  assert.equal(res.status, 200);
  const { streamer } = await json(res);
  assert.equal(streamer.login, "xqc");
  assert.equal(streamer.displayName, "xQc");
  assert.equal(streamer.groupName, "Faves");
  assert.equal(streamer.isHidden, false);
});

test("pinning uses the General group by default and never creates duplicates", async () => {
  const u = await createUser();
  await pin(u.cookie, { login: "shroud" });
  const again = await pin(u.cookie, { login: "SHROUD" });
  assert.equal((await json(again)).message, "Streamer already pinned");
  assert.equal(await count("pinned_streamers", u.id), 1);
  assert.equal((await list(u.cookie))[0].groupName, "General");
});

test("the list is ordered by sort order and reports live creators", async () => {
  const u = await createUser();
  await pin(u.cookie, { login: "aaa_one" });
  await pin(u.cookie, { login: "bbb_two" });
  await PATCH(send("PATCH", { login: "bbb_two", sortOrder: -1 }, u.cookie));
  restore();
  restore = mockFetch(() => gqlUsers(["aaa_one"], ["bbb_two"]));

  const streamers = await list(u.cookie);
  assert.deepEqual(streamers.map((s) => s.login), ["bbb_two", "aaa_one"]);
  assert.deepEqual(streamers.map((s) => s.isLive), [false, true]);
});

test("the list still loads when Twitch is unreachable", async () => {
  const u = await createUser();
  await pin(u.cookie, { login: "offline_ok" });
  restore();
  restore = mockFetch(() => { throw new Error("network down"); });
  const streamers = await list(u.cookie);
  assert.equal(streamers.length, 1);
  assert.equal(streamers[0].isLive, false);
});

test("updating a single creator: group, visibility and order", async () => {
  const u = await createUser();
  await pin(u.cookie, { login: "single_up" });
  const res = await PATCH(send("PATCH", { login: "single_up", groupName: "Cooking", isHidden: true, sortOrder: 4.6 }, u.cookie));
  assert.equal(res.status, 200);
  const [s] = await list(u.cookie);
  assert.deepEqual([s.groupName, s.isHidden, s.sortOrder], ["Cooking", true, 5]);

  assert.equal((await PATCH(send("PATCH", { login: "single_up" }, u.cookie))).status, 400); // nothing to update
  assert.equal((await PATCH(send("PATCH", { login: "not_pinned", isHidden: true }, u.cookie))).status, 404);
  assert.equal((await PATCH(send("PATCH", { isHidden: true }, u.cookie))).status, 400); // no login
});

test("batch updates, group rename and group delete", async () => {
  const u = await createUser();
  for (const login of ["bat_a", "bat_b", "bat_c"]) await pin(u.cookie, { login, groupName: "Old" });

  await PATCH(send("PATCH", { updates: [{ login: "bat_a", isHidden: true }, { login: "bat_b", sortOrder: 9 }, { login: "??" }] }, u.cookie));
  const byLogin = Object.fromEntries((await list(u.cookie)).map((s) => [s.login, s]));
  assert.equal(byLogin.bat_a.isHidden, true);
  assert.equal(byLogin.bat_b.sortOrder, 9);

  await PATCH(send("PATCH", { action: "renameGroup", oldGroup: "Old", newGroup: "Renamed" }, u.cookie));
  assert.ok((await list(u.cookie)).every((s) => s.groupName === "Renamed"));
  assert.equal((await PATCH(send("PATCH", { action: "renameGroup", oldGroup: "", newGroup: "x" }, u.cookie))).status, 400);

  await PATCH(send("PATCH", { action: "deleteGroup", groupName: "Renamed" }, u.cookie));
  assert.ok((await list(u.cookie)).every((s) => s.groupName === "General"));
  assert.equal((await PATCH(send("PATCH", { action: "deleteGroup", groupName: "" }, u.cookie))).status, 400);
});

test("unpinning removes the creator, with 404 for unknown ones", async () => {
  const u = await createUser();
  await pin(u.cookie, { login: "bye_bye" });
  const del = (login) => DELETE(request(`/api/streamers/pinned?login=${login}`, { method: "DELETE", cookie: u.cookie }));
  assert.equal((await del("bye_bye")).status, 200);
  assert.equal((await del("bye_bye")).status, 404);
  assert.equal((await del("bad%20login")).status, 400);
  assert.deepEqual(await list(u.cookie), []);
});

test("one user can never read or change another user's pinned creators", async () => {
  const a = await createUser();
  const b = await createUser();
  await pin(a.cookie, { login: "private_one", groupName: "Mine" });

  assert.deepEqual(await list(b.cookie), []);
  assert.equal((await PATCH(send("PATCH", { login: "private_one", isHidden: true }, b.cookie))).status, 404);
  assert.equal((await DELETE(request("/api/streamers/pinned?login=private_one", { method: "DELETE", cookie: b.cookie }))).status, 404);
  // group operations are scoped to the caller's own rows too
  await PATCH(send("PATCH", { action: "renameGroup", oldGroup: "Mine", newGroup: "Stolen" }, b.cookie));
  await PATCH(send("PATCH", { action: "deleteGroup", groupName: "Mine" }, b.cookie));

  const [s] = await list(a.cookie);
  assert.deepEqual([s.groupName, s.isHidden], ["Mine", false]);
  // and both users can pin the same creator independently
  assert.equal((await pin(b.cookie, { login: "private_one" })).status, 200);
  assert.equal(await count("pinned_streamers", b.id), 1);
});
