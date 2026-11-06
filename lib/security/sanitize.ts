export interface ValidationResult<T> {
  isValid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validates a username.
 * Strictly permits only alphanumeric characters and underscores (3-25 chars).
 * Explicitly blocks any HTML tags, script vectors, or special characters.
 */
export function validateUsername(input: unknown): ValidationResult<string> {
  if (typeof input !== "string") {
    return { isValid: false, error: "Username must be a string" };
  }

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Explicit check for script injection / HTML tags
  if (/[<>]|javascript:|data:text\/html|<script|on\w+=/i.test(trimmed)) {
    return { isValid: false, error: "Script injection and HTML tags are strictly disallowed in usernames" };
  }

  if (trimmed.length < 3) {
    return { isValid: false, error: "Username must be at least 3 characters long" };
  }

  if (trimmed.length > 25) {
    return { isValid: false, error: "Username cannot exceed 25 characters" };
  }

  // Reject usernames that start with a number
  if (/^[0-9]/.test(trimmed)) {
    return { isValid: false, error: "Username cannot start with a number" };
  }

  // Strictly enforce alphanumeric and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { isValid: false, error: "Username can only contain letters, numbers, and underscores (no spaces or symbols)" };
  }

  return { isValid: true, value: lower };
}

export function sanitizeUsername(input: unknown): string | null {
  const result = validateUsername(input);
  return result.isValid ? result.value! : null;
}

export function sanitizeLogin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toLowerCase();
  if (!/^[a-zA-Z0-9_]{2,30}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export function sanitizeVodId(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const cleaned = String(input).trim().replace(/[^0-9]/g, "");
  if (!cleaned || cleaned.length > 20) {
    return null;
  }
  return cleaned;
}

/**
 * Validates a password.
 * Passwords allow any printable character and symbol (including <, >, quotes, etc.)
 * without being constrained by the text allowlist regex, as passwords are never rendered
 * raw in HTML and are exclusively hashed via bcrypt before database storage.
 * Enforces length (6 to 128 chars) and blocks null bytes.
 */
export function validatePassword(input: unknown): ValidationResult<string> {
  if (typeof input !== "string") {
    return { isValid: false, error: "Password must be a string" };
  }

  if (input.length < 6) {
    return { isValid: false, error: "Password must be at least 6 characters long" };
  }

  if (input.length > 128) {
    return { isValid: false, error: "Password cannot exceed 128 characters" };
  }

  // Strictly block null bytes
  if (input.includes("\0")) {
    return { isValid: false, error: "Password cannot contain null bytes" };
  }

  return { isValid: true, value: input };
}

export function sanitizePassword(input: unknown): string | null {
  const result = validatePassword(input);
  return result.isValid ? result.value! : null;
}

export function sanitizeNumber(
  input: unknown,
  min = 0,
  max = 1000000,
  fallback = 0
): number {
  if (typeof input === "number" && !isNaN(input)) {
    return Math.max(min, Math.min(max, Math.floor(input)));
  }
  if (typeof input === "string") {
    const parsed = parseInt(input.trim(), 10);
    if (!isNaN(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return fallback;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validates URLs for image box-art, avatars, or external links.
 * Strictly enforces https:// or http:// protocols to prevent javascript: or data: pseudo-protocols.
 */
export function sanitizeUrl(input: unknown, maxLength = 500): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > maxLength) return "";

  // Reject any script or data pseudo-protocols
  if (/^(javascript:|data:|vbscript:|file:)/i.test(trimmed)) {
    return "";
  }

  // Reject control characters or null bytes
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // If it's a relative path starting with /
    if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/\\")) {
      return trimmed.slice(0, maxLength);
    }
  }

  return "";
}

/**
 * Validates a category or game name against a safe allowlist.
 * Twitch category names are game titles, creative genres, etc.
 * Permits letters, numbers, spaces, and standard title punctuation: - : ' / . & + ! ? ( ) # ,
 * Strictly disallows HTML tags, event handlers (on*=), quotes, brackets, and script vectors.
 */
export function validateCategoryName(input: unknown): ValidationResult<string> {
  if (typeof input !== "string") {
    return { isValid: false, error: "Category name must be a string" };
  }

  const trimmed = input.trim();

  if (trimmed.length < 1) {
    return { isValid: false, error: "Category name cannot be empty" };
  }

  if (trimmed.length > 100) {
    return { isValid: false, error: "Category name cannot exceed 100 characters" };
  }

  // Block HTML tags and script execution vectors
  if (/[<>]|javascript:|data:text\/html|<script|on\w+\s*=/i.test(trimmed)) {
    return { isValid: false, error: "Script injection and HTML tags are disallowed in category names" };
  }

  // Block null bytes and control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { isValid: false, error: "Category name contains invalid control characters" };
  }

  // Allowlist pattern: letters (including unicode), numbers, spaces, and safe title punctuation
  const allowedTitlePattern = /^[\p{L}\p{N}\s\-:_'.&+!?()#,\/]+$/u;
  if (!allowedTitlePattern.test(trimmed)) {
    return { isValid: false, error: "Category name contains unsupported special characters" };
  }

  return { isValid: true, value: trimmed };
}

export function sanitizeText(input: unknown, maxLength = 255): string {
  if (typeof input !== "string") return "";

  // Strip control characters and null bytes
  let cleaned = input.replace(/[\x00-\x1F\x7F]/g, "").trim();

  // Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, "");

  // Strip script prefixes and event handlers
  cleaned = cleaned.replace(/javascript:|vbscript:|data:text\/html/gi, "");
  cleaned = cleaned.replace(/on\w+\s*=/gi, "");

  // Strip remaining dangerous quotes or brackets
  cleaned = cleaned.replace(/[<>'"]/g, "");

  return cleaned.slice(0, maxLength);
}
