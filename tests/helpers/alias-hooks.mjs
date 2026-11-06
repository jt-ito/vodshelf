// Node module-resolution hooks so tests can import the app's TypeScript the way Next.js does:
//  - "@/foo" path alias       -> <repo>/foo.ts
//  - extensionless imports    -> .ts / .tsx / index.ts
//  - next/server, next/headers -> thin shims (Next's CJS entry points don't expose named ESM exports)
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHIMS = {
  "next/server": pathToFileURL(join(ROOT, "tests/helpers/next-server-shim.mjs")).href,
  "next/headers": pathToFileURL(join(ROOT, "tests/helpers/next-headers-shim.mjs")).href,
};

function withExtension(filePath) {
  if (extname(filePath) && existsSync(filePath)) return filePath;
  for (const candidate of [`${filePath}.ts`, `${filePath}.tsx`, join(filePath, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (SHIMS[specifier] && !context.parentURL?.endsWith("-shim.mjs")) {
    return { url: SHIMS[specifier], shortCircuit: true };
  }

  let target = null;
  if (specifier.startsWith("@/")) {
    target = join(ROOT, specifier.slice(2));
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = fileURLToPath(new URL(specifier, context.parentURL));
  }

  if (target) {
    const resolved = withExtension(target);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
