/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@cinema/ui", "@cinema/shared", "@cinema/database"],
  reactStrictMode: true,
};

export default nextConfig;
