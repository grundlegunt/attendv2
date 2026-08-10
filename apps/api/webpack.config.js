const { builtinModules } = require("node:module");

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

/**
 * Bundle the internal workspace packages into the production API artifact.
 *
 * The workspace packages intentionally expose TypeScript source for local
 * development. Plain Node cannot execute those sources when it starts the
 * compiled Nest application, so they must be included in the API bundle.
 * Prisma remains external because its generated engine is platform-specific.
 * Everything else is bundled so dependencies declared by internal workspace
 * packages resolve correctly under pnpm's strict dependency layout.
 */
module.exports = (options) => ({
  ...options,
  externals: [
    ({ request }, callback) => {
      if (request && (nodeBuiltins.has(request) || request === "@prisma/client" || request === "argon2")) {
        return callback(null, `commonjs ${request}`);
      }

      return callback();
    },
  ],
});
