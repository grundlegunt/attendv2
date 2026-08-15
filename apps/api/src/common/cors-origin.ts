const ADMIN_PREVIEW_ORIGIN = /^https:\/\/attendv2-admin-[a-z0-9-]+-attend3\.vercel\.app$/;
const CUSTOMER_PREVIEW_ORIGIN = /^https:\/\/attendv2-(?!admin-)[a-z0-9-]+-attend3\.vercel\.app$/;
const PLATFORM_PREVIEW_ORIGIN = /^https:\/\/attend-master-[a-z0-9-]+-attend3\.vercel\.app$/;

const FIRST_PARTY_PRODUCTION_ORIGINS = new Set([
  "https://attendv2-attend3.vercel.app",
  "https://attendv2-admin-attend3.vercel.app",
  "https://attend-master-attend3.vercel.app",
  "https://attend-company.vercel.app",
]);

export function isCorsOriginAllowed(origin: string | undefined, configuredOrigins: string[]): boolean {
  if (!origin) return true;
  if (configuredOrigins.includes(origin) || FIRST_PARTY_PRODUCTION_ORIGINS.has(origin)) return true;
  return ADMIN_PREVIEW_ORIGIN.test(origin) || CUSTOMER_PREVIEW_ORIGIN.test(origin) || PLATFORM_PREVIEW_ORIGIN.test(origin);
}

export function isPlatformOriginAllowed(origin: string): boolean {
  return origin === "http://localhost:3004" || origin === "http://127.0.0.1:3004" || origin === "https://attend-master-attend3.vercel.app" || origin === "https://attend-company.vercel.app" || PLATFORM_PREVIEW_ORIGIN.test(origin);
}
