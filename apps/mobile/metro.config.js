const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `packages/core` is written as ES modules with `.js` extensions on its TypeScript imports
// (`./parseName.js` really means `./parseName.ts`), which is what tsc and Vite understand. Metro
// looks for the literal file, so retry without the extension and let it find the .ts/.tsx.
// src/ui/icons.ts loads each icon from its own file rather than the package's barrel, which requires all ~1,670 of them.
// The package's exports map only lists the barrel, so these per-icon paths are resolved to the file directly.
const ICONOIR_FILE = /^iconoir-react-native\/(dist\/regular\/[A-Za-z0-9]+\.js)$/;
const iconoirRoot = path.dirname(require.resolve("iconoir-react-native", { paths: [__dirname] })).replace(/[\\/]dist$/, "");

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const icon = ICONOIR_FILE.exec(moduleName);
  if (icon) return { type: "sourceFile", filePath: path.join(iconoirRoot, icon[1]) };
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
