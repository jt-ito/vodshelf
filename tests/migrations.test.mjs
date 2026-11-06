import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

test("migrations upgrade a legacy database and are recorded once", async () => {
  const url = pathToFileURL(join(mkdtempSync(join(tmpdir(), "mig-")), "legacy.db")).href;
  const legacy = createClient({ url });
  await legacy.execute("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)");
  await legacy.execute("INSERT INTO users (id, username, password_hash) VALUES ('u1','a','h')");
  legacy.close();

  process.env.ARCHIVE_DB_URL = url;
  const { ensureDbReady } = await import("@/lib/db");
  const db = await ensureDbReady();

  const cols = (await db.execute("PRAGMA table_info(users)")).rows.map((r) => r.name);
  assert.ok(cols.includes("token_version") && cols.includes("mark_all_watched_scope"));
  const u = (await db.execute("SELECT token_version FROM users WHERE id='u1'")).rows[0];
  assert.equal(Number(u.token_version), 1);
  const versions = (await db.execute("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => Number(r.version));
  assert.deepEqual(versions, [1, 2, 3]);
});
