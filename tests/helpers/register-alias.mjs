import * as nodeModule from "node:module";
import { resolve } from "./alias-hooks.mjs";

// registerHooks (Node 22.15+/23.5+) runs in-thread; fall back to register() on older Node
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({ resolve });
} else {
  nodeModule.register("./alias-hooks.mjs", import.meta.url);
}
