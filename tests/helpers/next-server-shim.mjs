import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("next/server.js");
export const NextRequest = mod.NextRequest;
export const NextResponse = mod.NextResponse;
export default mod;
