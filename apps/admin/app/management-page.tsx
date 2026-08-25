"use client";

import { useAdminSession } from "./admin-session";
import { ManagementControls } from "./management-controls";
import { ManagementDashboard } from "./management-dashboard";

type DashboardSection = "reports" | "labor" | "branding" | "location" | "promotions" | "merch" | "audit";
type ControlSection = "taxes" | "users" | "refunds";

export function ManagementPage({ section }: { section: DashboardSection | ControlSection }) {
  const { employee, accessToken } = useAdminSession();
  if (!employee || !accessToken) return null;

  return (
    <main className="admin-route-page">
      {section === "taxes" || section === "users" || section === "refunds" ? (
        <ManagementControls accessToken={accessToken} permissions={employee.permissions} section={section} timeZone={employee.timezone} />
      ) : (
        <ManagementDashboard accessToken={accessToken} permissions={employee.permissions} section={section} timeZone={employee.timezone} />
      )}
    </main>
  );
}
