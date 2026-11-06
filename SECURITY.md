# Security

This document details the security architecture and protections implemented across the Twitch VOD CDN Archive platform. The application follows a defense-in-depth strategy with multiple overlapping security layers.

---

## Table of Contents

- [Authentication](#authentication)
- [Session Management](#session-management)
- [Authorization & Row-Level Security](#authorization--row-level-security)
- [CSRF Protection](#csrf-protection)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [SQL Injection Prevention](#sql-injection-prevention)
- [Rate Limiting](#rate-limiting)
- [SSRF Prevention](#ssrf-prevention)
- [Error Handling & Information Disclosure](#error-handling--information-disclosure)
- [Secrets Management](#secrets-management)
- [Security Response Headers](#security-response-headers)
- [Logging & Audit Trail](#logging--audit-trail)
- [Memory Safety & Denial of Service](#memory-safety--denial-of-service)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)

---

## Authentication

### Password Hashing

All user passwords are hashed using **bcrypt** with a work factor of **12 salt rounds** before storage, aligned with OWASP recommendations (~300ms computation time per hash). Plaintext passwords are never stored, logged, or transmitted after initial receipt.

**Implementation**: `lib/auth/session.ts` — `hashPassword()`, `verifyPassword()`

### Password Policy

Passwords are validated through `lib/security/sanitize.ts` — `validatePassword()`:

| Rule                  | Value          |
|-----------------------|----------------|
| Minimum length        | 6 characters   |
| Maximum length        | 128 characters |
| Null byte injection   | Blocked        |
| Character restrictions | Any printable character allowed (passwords are hashed, never rendered) |

### Credential Error Messages

Login failures return a generic `"Invalid username or password"` response regardless of whether the username or password was incorrect, preventing username enumeration.

---

## Session Management

### JWT Tokens

Sessions are implemented as stateless **JSON Web Tokens (JWTs)** signed with **HS256** using a secret derived from the `JWT_SECRET` environment variable.

| Property         | Value                                |
|------------------|--------------------------------------|
| Algorithm        | HS256                                |
| Expiration       | 30 days                             |
| Claims           | `id`, `username`, `tokenVersion`     |
| Library          | `jose` (v5.x)                       |

### Session Cookies

JWTs are stored in cookies with the following security attributes:

| Attribute    | Value                                            |
|-------------|--------------------------------------------------|
| `HttpOnly`  | `true` — inaccessible to JavaScript              |
| `Secure`    | `true` in all non-development environments        |
| `SameSite`  | `Lax` — blocks cross-site POST submissions        |
| `Path`      | `/`                                               |
| `Max-Age`   | 30 days                                          |

**Implementation**: `lib/auth/session.ts` — `AUTH_COOKIE_CONFIG`

### Token Versioning & Instant Revocation

Each user has a `token_version` integer in the database. On every authenticated request, `getCurrentUser()` verifies that the JWT's embedded `tokenVersion` matches the database value. If they differ, the session is rejected.

Token version is incremented on:
- **Password change** — all existing sessions across all devices are immediately invalidated.
- **Logout** — the user's active sessions are revoked server-side.

This provides instantaneous session revocation without waiting for natural JWT expiration.

**Implementation**: `lib/auth/session.ts` — `revokeUserSessions()`, `getCurrentUser()`

### JWT Secret Enforcement

The application **refuses to start** in any non-development environment if `JWT_SECRET` is not set. In development mode only, a long fallback secret is used for convenience. This prevents accidental deployment with a publicly-known secret.

---

## Authorization & Row-Level Security

Every database query that reads, creates, updates, or deletes user-owned resources is **strictly scoped by `user.id`** from the authenticated session. The application never trusts client-supplied user IDs alone.

### Enforced Across All Tables

| Table                 | RLS Scope                        |
|-----------------------|----------------------------------|
| `pinned_streamers`    | `WHERE user_id = ?` with session `user.id` |
| `watch_status`        | `WHERE user_id = ?` with session `user.id` |
| `favorite_categories` | `WHERE user_id = ?` with session `user.id` |
| `users`               | `WHERE id = ?` with session `user.id`      |

This prevents **Insecure Direct Object Reference (IDOR)** attacks — a user cannot read or modify another user's pinned streamers, watch history, or account settings, even by manipulating request parameters.

**Implementation**: Every API route in `app/api/` enforces this pattern. See `app/api/streamers/pinned/route.ts`, `app/api/watch/progress/route.ts`, `app/api/categories/favorites/route.ts`, etc.

---

## CSRF Protection

### Origin / Referer Validation

The Next.js middleware (`middleware.ts`) validates all state-changing API requests (`POST`, `PUT`, `DELETE`, `PATCH`) by checking the `Origin` or `Referer` header against the expected host:

1. If an `Origin` header is present, its host must match the server's host.
2. If no `Origin` but a `Referer` header is present, the referer's host must match.
3. If **neither** header is present, the request is **rejected with 403**.

This prevents cross-site request forgery from malicious pages, forms, or embedded contexts.

### SameSite Cookie Policy

Session cookies use `SameSite=Lax`, which blocks cross-site `POST` submissions — a second layer of CSRF defense independent of the middleware check.

**Implementation**: `middleware.ts`

---

## Input Validation & Sanitization

All user-supplied input is validated through a centralized sanitization module (`lib/security/sanitize.ts`) before being used in any database query or response.

### Username Validation — `validateUsername()`

| Rule                           | Enforcement                                   |
|--------------------------------|-----------------------------------------------|
| Type check                     | Must be a string                              |
| Length                         | 3–25 characters           |
| Allowed characters             | Alphanumeric and underscores only (`/^[a-zA-Z0-9_]+$/`) |
| Cannot start with a number     | `/^[0-9]/` rejected                           |
| HTML/script injection          | `<`, `>`, `javascript:`, `data:text/html`, `onload=` etc. blocked |
| Change cooldown                | 15-day server-side cooldown enforced via `username_changed_at` |

### Login Sanitization — `sanitizeLogin()`

Streamer login names are restricted to `[a-zA-Z0-9_]{2,30}` and lowercased.

### VOD ID Sanitization — `sanitizeVodId()`

VOD IDs are stripped to digits only, with a maximum length of 20 characters.

### URL Sanitization — `sanitizeUrl()`

| Rule                    | Enforcement                                    |
|-------------------------|------------------------------------------------|
| Protocol allowlist      | `https:` and `http:` only                       |
| Blocked pseudo-protocols | `javascript:`, `data:`, `vbscript:`, `file:`   |
| Control characters      | Rejected                                       |
| Null bytes              | Rejected                                       |
| Maximum length          | 500 characters (configurable)                  |
| Relative paths          | Only `/`-prefixed paths allowed (no `//` or `/\`) |

### Category Name Validation — `validateCategoryName()`

Uses a Unicode-aware allowlist pattern permitting letters, numbers, spaces, and common title punctuation (`- : ' / . & + ! ? ( ) # ,`). HTML tags, script vectors, event handlers, and control characters are blocked.

### Text Sanitization — `sanitizeText()`

General-purpose sanitizer that strips control characters, HTML tags, script prefixes (`javascript:`, `vbscript:`, `data:text/html`), event handlers (`on*=`), and dangerous characters (`< > ' "`). Truncates to a configurable maximum length.

### Numeric Sanitization — `sanitizeNumber()`

Clamps numeric input to a configurable `[min, max]` range with a fallback default, preventing overflow or out-of-bounds values.

### HTML Escaping — `escapeHtml()`

Escapes `& < > " ' /` for any context where user data might be rendered in HTML.

---

## SQL Injection Prevention

**Every database query uses parameterized statements** with the `args` parameter array. No user input is ever concatenated into SQL strings.

```typescript
// Example — all queries follow this pattern
await db.execute({
  sql: "SELECT id FROM users WHERE username = ?",
  args: [username],  // Parameterized — never interpolated
});
```

Dynamic `IN (...)` clauses are constructed with placeholder arrays:

```typescript
const placeholders = vodIds.map(() => "?").join(",");
const sql = `SELECT ... WHERE user_id = ? AND vod_id IN (${placeholders})`;
const args = [user.id, ...vodIds];
```

Dynamic `SET` clauses (e.g., batch updates in `PATCH /api/streamers/pinned`) are built from sanitized field names with parameterized values:

```typescript
setClauses.push("group_name = ?");
args.push(sanitizeText(item.groupName, 30));
```

**Implementation**: `lib/db/index.ts`, all route files in `app/api/`

---

## Rate Limiting

In-memory per-IP rate limiting is applied to **every API endpoint** via `lib/security/rate-limit.ts`. Rate limits use a sliding window algorithm with per-prefix tracking.

### Endpoint Rate Limits

| Endpoint                  | Limit                   | Window     |
|---------------------------|-------------------------|------------|
| `POST /api/auth/register` | 8 requests              | 10 minutes |
| `POST /api/auth/login`    | 15 requests             | 10 minutes |
| `POST /api/auth/logout`   | 30 requests             | 1 minute   |
| `GET /api/auth/me`        | 60 requests             | 1 minute   |
| `PUT /api/user/password`  | 10 requests             | 10 minutes |
| `PUT /api/user/username`  | 10 requests             | 10 minutes |
| `GET /api/user/settings`  | 60 requests             | 1 minute   |
| `GET /api/streamers/pinned` | 60 requests           | 1 minute   |
| `POST /api/streamers/pinned` | 30 requests          | 1 minute   |
| `PATCH /api/streamers/pinned` | 60 requests         | 1 minute   |
| `DELETE /api/streamers/pinned` | 30 requests        | 1 minute   |
| `GET /api/streamers/feed`   | 120 requests           | 1 minute   |
| `POST /api/streamers/feed`  | 30 requests            | 1 minute   |
| `GET /api/twitch/search`  | 60 requests             | 1 minute   |
| `GET /api/twitch/user/*`  | 60 requests             | 1 minute   |
| `GET /api/twitch/vods/*`  | 60 requests             | 1 minute   |
| `GET /api/twitch/cdn/*`   | 60 requests             | 1 minute   |
| `GET /api/twitch/cdn-list/*` | 60 requests          | 1 minute   |
| `GET /api/watch/progress` | 60 requests             | 1 minute   |
| `POST /api/watch/progress` | 120 requests           | 1 minute   |
| `POST /api/watch/bulk`    | 30 requests             | 1 minute   |
| `GET /api/categories/favorites` | 60 requests       | 1 minute   |
| `POST /api/categories/favorites` | 30 requests      | 1 minute   |
| `DELETE /api/categories/favorites` | 30 requests    | 1 minute   |
| `GET /api/proxy/m3u8`     | 200 requests            | 1 minute   |

Rate-limited responses return **HTTP 429** with a `Retry-After` header indicating when the client can retry.

### Deployment Note

The rate limiter extracts client IPs from `X-Forwarded-For` and `X-Real-IP` headers. These headers are only reliable when the application runs behind a **trusted reverse proxy** (Nginx, Cloudflare, Vercel) that strips or overwrites client-supplied forwarding headers. Without a trusted proxy, these headers can be spoofed.

---

## SSRF Prevention

The media proxy endpoint (`/api/proxy/m3u8`) allows the browser-based HLS player to fetch video segments through the server. To prevent Server-Side Request Forgery (SSRF), the following protections are enforced:

### Hostname Allowlist

The proxy only permits requests to a strict allowlist of known Twitch VOD infrastructure:

- **8 specific CloudFront domains** used by Twitch for VOD storage (imported from `CLOUDFRONT_DOMAINS` in `lib/twitch/cdn-prober.ts`)
- **`*.jtvnw.net`** and **`*.ttvnw.net`** — Twitch's general CDN domains
- **`api.vodvod.top`** — the stream indexer API

Any request targeting a hostname outside this list is rejected with **403 Forbidden**.

### Protocol Restriction

Only `https:` and `http:` protocols are accepted. Pseudo-protocols (`javascript:`, `data:`, `file:`, etc.) are blocked.

### URL Validation

Target URLs are parsed with `new URL()` to prevent URL-confusion attacks. Malformed URLs are rejected.

**Implementation**: `app/api/proxy/m3u8/route.ts`

---

## Error Handling & Information Disclosure

All API errors are processed through `handleApiError()` in `lib/security/errors.ts`, which:

1. **Logs** the full error (including stack traces in development) to the server console for debugging.
2. **Returns** a generic, user-safe error message to the client — never exposing internal details.

### What Is Never Leaked to Clients

- Database error messages or SQLite constraint details
- Stack traces
- File paths or server internals
- SQL query text
- Environment variable values

### Database Constraint Handling

Unique constraint violations (e.g., duplicate username on registration) are caught and translated to user-friendly messages like `"Username is already taken"` without revealing the underlying `SQLITE_CONSTRAINT` error.

---

## Secrets Management

### Environment Variables

Sensitive configuration is stored in `.env.local`, which is:

- **Gitignored** via multiple patterns in `.gitignore` (`.env`, `.env*.local`, `*.env`)
- **Never logged** — the logger module redacts fields named `password`, `currentPassword`, `newPassword`, `token`, `secret`, and `cookie`
- **Never exposed in API responses** — error handlers strip all internal details

### JWT Secret

- Stored exclusively in the `JWT_SECRET` environment variable
- The application **refuses to start** if `JWT_SECRET` is unset outside of development mode
- A `.env.example` file documents the expected format without including real values

### Twitch Client IDs

Public Twitch API client IDs (`kimne78kx3ncx6brgo4mv6wki5h1ko`, `ue6666qo983tsx6so1t0vnawi233wa`) are used for unauthenticated GQL queries. These are public identifiers (not secrets) that are visible in any Twitch web client.

---

## Security Response Headers

The following security headers are applied to all API responses via Next.js middleware:

| Header                       | Value                                      | Purpose                                |
|------------------------------|--------------------------------------------|-----------------------------------------|
| `X-Content-Type-Options`     | `nosniff`                                  | Prevents MIME-type sniffing             |
| `X-Frame-Options`            | `DENY`                                     | Prevents clickjacking via iframes       |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`          | Limits referrer information leakage     |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=()` | Disables unused browser APIs            |

**Implementation**: `middleware.ts`

---

## Logging & Audit Trail

The structured JSON logger (`lib/logger.ts`) records security-relevant events:

| Event                       | Log Level | Data Recorded                            |
|-----------------------------|-----------|------------------------------------------|
| User registration           | `info`    | `userId`, `username`                     |
| Successful login            | `info`    | `userId`, `username`                     |
| Logout & session revocation | `info`    | `userId`, `username`                     |
| Password change             | `info`    | `userId`                                 |
| Username change             | `info`    | `userId`, `oldUsername`, `newUsername`    |
| Streamer pinned/unpinned    | `info`    | `userId`, `streamer`, `group`            |
| Watch progress updated      | `info`    | `userId`, `vodId`, `isWatched`           |
| Bulk watch status updated   | `info`    | `userId`, `count`, `isWatched`           |
| Category favorited/removed  | `info`    | `userId`, `category`                     |
| API errors                  | `error`   | Endpoint name, sanitized error details   |

### Automatic Redaction

The logger automatically redacts the following fields from any metadata object before output:

- `password`
- `currentPassword`
- `newPassword`
- `token`
- `secret`
- `cookie`

Stack traces are only included in non-production log output.

---

## Memory Safety & Denial of Service

### In-Memory Cache Cap

The TTL cache (`lib/cache/ttl-cache.ts`) enforces a maximum of **25,000 entries**. When the cap is reached, the oldest entry is evicted before inserting a new one. This prevents memory exhaustion from sustained high-cardinality traffic (e.g., search queries with unique input).

### Rate-Limit Store Cap

The rate-limit tracking store (`lib/security/rate-limit.ts`) enforces a maximum of **50,000 entries**. Combined with periodic cleanup of expired records (every 60 seconds), this prevents memory growth from IP rotation attacks.

### Bulk Operation Limits

The bulk watch status endpoint (`POST /api/watch/bulk`) caps batch operations at **200 items per request** to prevent resource abuse.

### Request Coalescing

The TTL cache implements in-flight request deduplication — if multiple concurrent requests ask for the same cache key, only one outgoing fetch is executed. All callers share the result, preventing thundering herd problems against upstream APIs.

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly. Do not open a public issue.
