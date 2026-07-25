module.exports = {
  root: true,
  extends: ["./packages/config/eslint-preset.cjs"],
  ignorePatterns: ["dist/", ".next/", "node_modules/", "generated/", "**/*.js", "**/*.mjs", "**/*.cjs"],
};
