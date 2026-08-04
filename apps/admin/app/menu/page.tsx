"use client";

import { useAdminSession } from "../admin-session";
import { MenuManager } from "../menu-manager";

export default function MenuPage() {
  const { accessToken } = useAdminSession();
  return <main className="admin-route-page">{accessToken && <MenuManager accessToken={accessToken} />}</main>;
}
