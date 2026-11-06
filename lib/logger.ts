type LogLevel = "info" | "warn" | "error" | "debug";

class Logger {
  private format(level: LogLevel, message: string, meta?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    // Sanitize any passwords or tokens from metadata
    let safeMeta = meta ? { ...meta } : undefined;
    if (safeMeta) {
      if (safeMeta.password) safeMeta.password = "[REDACTED]";
      if (safeMeta.currentPassword) safeMeta.currentPassword = "[REDACTED]";
      if (safeMeta.newPassword) safeMeta.newPassword = "[REDACTED]";
      if (safeMeta.token) safeMeta.token = "[REDACTED]";
      if (safeMeta.secret) safeMeta.secret = "[REDACTED]";
      if (safeMeta.cookie) safeMeta.cookie = "[REDACTED]";
    }

    return JSON.stringify({
      timestamp,
      level,
      message,
      ...(safeMeta ? { meta: safeMeta } : {}),
    });
  }

  info(message: string, meta?: Record<string, any>) {
    console.log(this.format("info", message, meta));
  }

  warn(message: string, meta?: Record<string, any>) {
    console.warn(this.format("warn", message, meta));
  }

  error(message: string, err?: any, meta?: Record<string, any>) {
    const errorDetails = err instanceof Error ? {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    } : { raw: String(err) };

    console.error(this.format("error", message, { ...meta, error: errorDetails }));
  }

  debug(message: string, meta?: Record<string, any>) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(this.format("debug", message, meta));
    }
  }
}

export const logger = new Logger();
