// Lets plain Node run packages/core's TypeScript, which imports "./x.js" for files that are really "./x.ts".
// Use: node --experimental-strip-types --import ./scripts/ts-resolve.mjs <script>
import { register } from "node:module";

const hook = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
}`;
register("data:text/javascript;base64," + Buffer.from(hook).toString("base64"));
