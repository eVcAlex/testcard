const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `packages/core` is written as ES modules with `.js` extensions on its TypeScript imports
// (`./parseName.js` really means `./parseName.ts`), which is what tsc and Vite understand. Metro
// looks for the literal file, so retry without the extension and let it find the .ts/.tsx.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const workspaceImport = moduleName.startsWith(".") || moduleName.startsWith("@testcard/");
  const resolve = resolveRequest ?? ((ctx, name, plat) => ctx.resolveRequest(ctx, name, plat));
  if (workspaceImport && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      /* not a TypeScript file behind a .js name: fall through to the literal path */
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
