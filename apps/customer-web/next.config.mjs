import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@cinema/ui", "@cinema/shared", "@cinema/database"],
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/api/v1/cinema/now-playing": [
      "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*",
    ],
  },
};

export default nextConfig;
