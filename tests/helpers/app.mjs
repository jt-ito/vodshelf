// Shared harness for route/integration tests: in-memory database, fake requests, test users.
import "./env.mjs";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const { ensureDbReady } = await import("@/lib/db");
const session = await import("@/lib/auth/session");

export const db = await ensureDbReady();
export const COOKIE_NAME = session.AUTH_COOKIE_CONFIG.name;

let counter = 0;

/** Builds a NextRequest. Every request gets its own client IP unless one is given, so rate limits don't leak between tests. */
export function request(path, { method = "GET", body, cookie, headers = {}, ip } = {}) {
  const n = counter++;
  const h = { "x-forwarded-for": ip ?? `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, ...headers };
  if (cookie) h.cookie = cookie;
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

let userCounter = 0;

/**
 * Inserts a user and returns a ready-to-use session cookie.
 * Pass realHash: true when the test needs to log in with the password (bcrypt, ~250ms).
 */
export async function createUser(username = `user_${++userCounter}_${randomUUID().slice(0, 6)}`, opts = {}) {
  const { password = "password123", realHash = false } = opts;
  const id = randomUUID();
  const name = username.toLowerCase();
  const hash = realHash ? await session.hashPassword(password) : "not-a-real-hash";
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash, token_version) VALUES (?, ?, ?, 1)",
    args: [id, name, hash],
  });
  const token = await session.createSessionToken({ id, username: name, tokenVersion: 1 });
  return { id, username: name, password, token, cookie: `${COOKIE_NAME}=${token}` };
}

/** The session cookie value a response set (or undefined). */
export function cookieFrom(res) {
  return res.cookies.get(COOKIE_NAME)?.value;
}

export const asCookie = (token) => `${COOKIE_NAME}=${token}`;

export async function count(table, userId) {
  const res = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, args: [userId] });
  return Number(res.rows[0].n);
}

/**
 * Replaces global fetch for the duration of a test (restore with the returned function).
 * handler(url, init) returns a Response, a plain object (sent as JSON) or throws to simulate a network error.
 */
export function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    calls.push({ url, init });
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  const restore = () => { globalThis.fetch = original; };
  restore.calls = calls;
  return restore;
}

/** Twitch GQL "users" batch response for getLiveStreams: live logins get a stream object. */
export function gqlUsers(liveLogins = [], allLogins = []) {
  const logins = [...new Set([...liveLogins, ...allLogins])];
  return {
    data: {
      users: logins.map((login) => ({
        login,
        stream: liveLogins.includes(login) ? { id: "1", title: "live now", type: "live", game: { name: "Chat" } } : null,
      })),
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until fn() is truthy (or throws after ms). For background work such as snapshot refreshes. */
export async function waitFor(fn, ms = 3000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = await fn();
    if (value) return value;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** A Twitch GQL video node as FilterableVideoTower_Videos returns it. */
export function videoNode(id, login, extra = {}) {
  return {
    id: String(id),
    title: `Stream ${id}`,
    broadcastType: "ARCHIVE",
    createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    publishedAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
    lengthSeconds: 3600,
    viewCount: 10,
    previewThumbnailURL: "https://static-cdn.jtvnw.net/cf_vods/x/thumb.jpg",
    game: { id: "509658", displayName: "Just Chatting", boxArtURL: "https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg" },
    owner: { id: "1", login, displayName: login },
    ...extra,
  };
}

/**
 * Fake Twitch GQL + VODVOD + TwitchTracker. Mutate `.state` between calls to change what upstream answers.
 *   state.videos      : GQL video nodes (grouped by owner.login)
 *   state.liveLogins  : channels reported live
 *   state.twitchDown  : every Twitch request throws a network error
 *   state.delayMs     : every Twitch request takes this long to answer
 *   state.vodvod      : { status, body }
 *   state.tracker     : { status, html }
 */
export function fakeUpstream(initial = {}) {
  const state = {
    videos: [], liveLogins: [], twitchDown: false,
    vodvod: { status: 200, body: [] },
    tracker: { status: 403, html: "blocked" },
    ...initial,
  };
  const restore = mockFetch(async (url, init) => {
    if (url.startsWith("https://gql.twitch.tv")) {
      if (state.delayMs) await sleep(state.delayMs); // simulate a slow Twitch
      if (state.twitchDown) throw new Error("twitch unreachable");
      const body = JSON.parse(init.body);
      if (body.operationName === "FilterableVideoTower_Videos") {
        const login = body.variables.channelOwnerLogin;
        const edges = state.videos.filter((v) => v.owner.login === login).map((node, i) => ({ cursor: `c${i}`, node }));
        return { data: { user: { id: "1", videos: { edges, pageInfo: { hasNextPage: false } } } } };
      }
      const q = body.query || "";
      if (q.includes("BatchCheckLive")) return gqlUsers(state.liveLogins, body.variables.logins);
      if (q.includes("GetSubOnlyVod")) return { data: { video: null } };
      if (q.includes("GetChannelMeta")) return { data: { user: null } };
      return { data: {} };
    }
    if (url.includes("api.vodvod.top/channels/")) {
      return state.vodvod.status === 200 ? state.vodvod.body : new Response("err", { status: state.vodvod.status });
    }
    if (url.includes("twitchtracker.com")) {
      return new Response(state.tracker.html, { status: state.tracker.status });
    }
    throw new Error(`unexpected request in test: ${url}`);
  });
  restore.state = state;
  restore.towerCalls = () => restore.calls.filter((c) => c.url.startsWith("https://gql.twitch.tv") && c.init?.body?.includes("FilterableVideoTower_Videos")).length;
  return restore;
}

/** Drops the in-memory upstream caches for a login so the next call must use the database snapshot or upstream. */
export async function clearMemoryCaches(login) {
  const { serverCache } = await import("@/lib/cache/ttl-cache");
  for (const key of [`gql:vods:${login}:30:head:ARCHIVE`, `indexer:unlisted:${login}`, `twitchtracker:streams:${login}`]) {
    serverCache.delete(key);
  }
}

/** A TwitchTracker /streams page in the obfuscated format the app decodes. rows: [{ date: "YYYY-MM-DD HH:mm", id, title }] */
export function trackerPage(rows) {
  const complicator = Object.fromEntries(rows.map((r) => [r.date, { id: r.id, games: [{ id: 1, name: "Chat" }] }]));
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
  const meta = `${b64(complicator)}!${b64(["complicator"])}`;
  const tr = rows.map((r) => `<tr><td data-order="${r.date}">d</td><td class="status x">${r.title}</td></tr>`).join("");
  return `<html><meta id="ecs" content="${meta}"><table>${tr}</table></html>`;
}
