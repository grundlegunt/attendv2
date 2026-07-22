/** @type {import('jest').Config} */
// Deliberately runs all integration spec files in a single in-band process
// (see package.json's `test:integration` script: `--runInBand`) so a
// single embedded Postgres instance can be shared safely across the suite
// via per-file beforeAll/afterAll — see test/test-db.ts.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
  moduleFileExtensions: ["js", "json", "ts"],
  testTimeout: 30000,
};
