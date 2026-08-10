export type PlatformRole = "OWNER" | "OPERATOR" | "VIEWER";

export interface StoredPlatformSession {
  accessToken: string;
  user: { id: string; name: string; email: string; role: PlatformRole };
}

export function readPlatformSession(storageKey: string): StoredPlatformSession | null {
  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<StoredPlatformSession>;
    const role = value.user?.role;
    if (typeof value.accessToken !== "string" || typeof value.user?.id !== "string" || typeof value.user.name !== "string" || typeof value.user.email !== "string" || !role || !["OWNER", "OPERATOR", "VIEWER"].includes(role)) {
      throw new Error("Stored Attend Master session is incompatible.");
    }
    return value as StoredPlatformSession;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return null;
  }
}
