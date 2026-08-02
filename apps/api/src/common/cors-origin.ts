const ADMIN_PREVIEW_ORIGIN = /^https:\/\/attendv2-admin-[a-z0-9-]+-attend3\.vercel\.app$/;

export function isCorsOriginAllowed(origin: string | undefined, configuredOrigins: string[]): boolean {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  return ADMIN_PREVIEW_ORIGIN.test(origin);
}

