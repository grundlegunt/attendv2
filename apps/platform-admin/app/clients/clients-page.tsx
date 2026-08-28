"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  adminUiDefaults,
  seatMapLayoutSchema,
  type AdminUiConfig,
  type CinemaContent,
  type SeatInput,
  type SeatMapLayout,
} from "@cinema/shared";
import { AdminUiEditor } from "../admin-ui-editor";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import {
  platformDownload,
  platformRequest,
  readPlatformSession,
  revokePlatformSession,
} from "../platform-session";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const CINEMA_ADMIN_URL =
  process.env.NEXT_PUBLIC_CINEMA_ADMIN_URL ?? "http://localhost:3003";
const CUSTOMER_WEB_URL =
  process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL ?? "http://localhost:3000";
const STORAGE_KEY = "attend-platform-session";
const RECOMMENDED_ADMIN_PALETTE = {
  adminAccentColor: "#ffb800",
  adminAccentMutedColor: "#8a6500",
  adminBackgroundColor: "#000000",
  adminSurfaceColor: "#1b1b1b",
  adminTextColor: "#ffffff",
  adminMutedTextColor: "#cccccc",
} as const;

interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "OPERATOR" | "VIEWER";
}
interface Session {
  accessToken: string;
  user: PlatformUser;
}
interface LocationOverview {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  active: boolean;
  configuration: {
    branding: boolean;
    auditoriums: number;
    employees: number;
    menuItems: number;
    upcomingShowtimes: number;
  };
}
interface OrganizationOverview {
  id: string;
  name: string;
  legalName: string | null;
  businessTypeLabel: string | null;
  defaultSeatingMode: "RESERVED" | "GENERAL_ADMISSION";
  timezone: string;
  active: boolean;
  payments: { connected: boolean; onboardingStatus: string };
  locations: LocationOverview[];
}
interface Overview {
  generatedAt: string;
  organizations: OrganizationOverview[];
}
interface RevenueTotals {
  ticketRevenueCents: number;
  ticketFeesCents: number;
  ticketTaxCents: number;
  ticketCollectedCents: number;
  fnbRevenueCents: number;
  combinedRevenueCents: number;
  membershipRevenueCents: number;
  membershipPurchases: number;
  donationRevenueCents: number;
  donations: number;
  nonprofitRevenueCents: number;
  totalCollectedCents: number;
  refundedCents: number;
  ticketsSold: number;
  fnbOrders: number;
}
interface RevenueReport {
  generatedAt: string;
  range: { from: string; to: string };
  totals: RevenueTotals;
  clients: Array<
    { id: string; name: string; locations: number } & RevenueTotals
  >;
}
const revenueRanges = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 365, label: "Last year" },
] as const;
type RevenueRange = (typeof revenueRanges)[number]["days"] | "custom";
type BrandPalette = {
  accentColor: string | null;
  accentMutedColor: string | null;
  backgroundColor: string | null;
  backgroundGlowColor: string | null;
  surfaceColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
};
interface OrganizationDetail {
  id: string;
  name: string;
  legalName: string | null;
  businessTypeLabel: string | null;
  defaultSeatingMode: "RESERVED" | "GENERAL_ADMISSION";
  timezone: string;
  active: boolean;
  ticketFeeMinor: number;
  registeredTicketFeeMinor: number;
  ticketFeeAgreements: Array<{
    id: string;
    name: string;
    customerFeeMinor: number;
    thresholdPeriod: "CONTRACT_YEAR" | "CALENDAR_YEAR" | "LIFETIME";
    effectiveFrom: string;
    effectiveTo: string | null;
    createdAt: string;
    tiers: Array<{ startsAtTicket: number; endsAtTicket: number | null; platformShareMinor: number; operatorShareMinor: number }>;
  }>;
  ticketFeeSettlement: null | {
    agreementId: string;
    agreementName: string;
    thresholdPeriod: "CONTRACT_YEAR" | "CALENDAR_YEAR" | "LIFETIME";
    asOf: string;
    periodFrom: string;
    periodTo: string | null;
    tickets: number;
    collectedFeeCents: number;
    platformShareCents: number;
    operatorShareCents: number;
    varianceCents: number;
    activeTier: { startsAtTicket: number; endsAtTicket: number | null; platformShareMinor: number; operatorShareMinor: number; ticketsRemaining: number | null };
  };
  ticketFeeRemittances: Array<{
    id: string;
    agreementId: string;
    periodFrom: string;
    periodTo: string;
    statementAsOf: string;
    ticketCount: number;
    collectedFeeCents: number;
    platformShareCents: number;
    operatorShareCents: number;
    varianceCents: number;
    status: "DUE" | "PAID" | "VOID";
    dueDate: string | null;
    paidAt: string | null;
    paymentReference: string | null;
    notes: string | null;
    lastContactedAt: string | null;
    nextFollowUpAt: string | null;
    collectionOwner: { id: string; name: string; email: string } | null;
    createdAt: string;
  }>;
  createdAt: string;
  payments: { connected: boolean; onboardingStatus: string };
  health: { failedPayments24h: number; processingPayments: number; verificationReviews: number; failedRefunds: number; stalePayments: number; staleRefunds: number; managerReviewTabs: number; expiredHoldBacklog: number; lastSuccessfulPaymentAt: string | null; trends: { paymentFailure: { current: { failed: number; total: number; ratePercent: number | null }; previous: { failed: number; total: number; ratePercent: number | null } }; refunds: { current: { refundedCents: number; capturedCents: number; ratePercent: number | null }; previous: { refundedCents: number; capturedCents: number; ratePercent: number | null } } } };
  locations: Array<{
    id: string;
    name: string;
    address: string | null;
    timezone: string;
    currency: string;
    active: boolean;
    branding: BrandPalette & { logoUrl: string | null };
    adminBranding: BrandPalette & { ui: AdminUiConfig };
    brandingDraft: {
      values: {
        logoUrl?: string | null;
        accentColor?: string | null;
        accentMutedColor?: string | null;
        backgroundColor?: string | null;
        backgroundGlowColor?: string | null;
        surfaceColor?: string | null;
        textColor?: string | null;
        mutedTextColor?: string | null;
        adminAccentColor?: string | null;
        adminAccentMutedColor?: string | null;
        adminBackgroundColor?: string | null;
        adminSurfaceColor?: string | null;
        adminTextColor?: string | null;
        adminMutedTextColor?: string | null;
        adminUi: AdminUiConfig;
      };
      draftedAt: string | null;
    } | null;
    content: {
      draft: CinemaContent;
      published: CinemaContent;
      publishedAt: string | null;
    };
    operations: {
      ticketTaxRateBasisPoints: number;
      preShowBufferMinutes: number;
      cleaningBufferMinutes: number;
      checkDropMinutesBeforeEnd: number;
      autoSettleGraceMinutes: number;
      timeClockEnabled: boolean;
    };
    auditoriums: Array<{
      id: string;
      name: string;
      capacity: number;
      seatingMode: "RESERVED" | "GENERAL_ADMISSION";
      active: boolean;
      seatMap: {
        id: string;
        name: string;
        version: number;
        activeSeats: number;
        accessibleSeats: number;
        companionSeats: number;
        layout: SeatMapLayout | null;
        seats: Array<{
          id: string;
          label: string;
          rowLabel: string;
          number: number;
          x: number;
          y: number;
          active: boolean;
          type: "STANDARD" | "ADA" | "COMPANION";
          tableGroupId?: string | null;
          tablePosition?: "LEFT" | "RIGHT" | null;
          levelKey?: string | null;
          sectionKey?: string | null;
        }>;
      } | null;
    }>;
    configuration: {
      auditoriums: number;
      employees: number;
      menuItems: number;
      upcomingShowtimes: number;
      activeMovies: number;
      activeFilmSeries: number;
    };
  }>;
}
type OrganizationDraft = {
  name: string;
  legalName: string;
  businessTypeLabel: string;
  defaultSeatingMode: "RESERVED" | "GENERAL_ADMISSION";
  timezone: string;
  ticketFee: string;
  registeredTicketFee: string;
};
type OrganizationCreateDraft = {
  name: string;
  legalName: string;
  businessTypeLabel: string;
  defaultSeatingMode: "RESERVED" | "GENERAL_ADMISSION";
  timezone: string;
  locationName: string;
  address: string;
  locationTimezone: string;
};
type TicketFeeAgreementDraft = {
  name: string;
  customerFee: string;
  structure: "FLAT" | "TIERED";
  thresholdPeriod: "CONTRACT_YEAR" | "CALENDAR_YEAR" | "LIFETIME";
  effectiveFrom: string;
  thresholdTickets: string;
  firstPlatformShare: string;
  secondPlatformShare: string;
};
type CinemaManagerDraft = {
  locationId: string;
  name: string;
  email: string;
  password: string;
};
type AuditoriumDraft = {
  id?: string;
  locationId: string;
  name: string;
  seatingMode: "RESERVED" | "GENERAL_ADMISSION";
  seatingStyle: SeatMapLayout["seatingStyle"];
  capacity: number;
  rows: number;
  seatsPerRow: number;
  centerAisle: boolean;
  accessiblePairs: number;
  sourceSeats?: SeatInput[];
  sourceLayout?: SeatMapLayout;
};
type LocationDetail = OrganizationDetail["locations"][number];
type LocationDraft = {
  name: string;
  address: string;
  timezone: string;
  active: boolean;
  logoUrl: string;
  accentColor: string;
  accentMutedColor: string;
  backgroundColor: string;
  backgroundGlowColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  adminAccentColor: string;
  adminAccentMutedColor: string;
  adminBackgroundColor: string;
  adminSurfaceColor: string;
  adminTextColor: string;
  adminMutedTextColor: string;
  adminUi: AdminUiConfig;
  ticketTaxRateBasisPoints: number;
  preShowBufferMinutes: number;
  cleaningBufferMinutes: number;
  checkDropMinutesBeforeEnd: number;
  autoSettleGraceMinutes: number;
  timeClockEnabled: boolean;
};

function request<T>(
  path: string,
  init?: RequestInit,
  accessToken?: string,
): Promise<T> {
  return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken);
}
function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
function currencyInputCents(value: string) {
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) ? cents : 0;
}
function csvCell(value: string | number | boolean) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
function healthRate(value: number | null) { return value === null ? "No activity" : `${value.toFixed(2)}%`; }
function dateInputValue(date: Date) { return date.toISOString().slice(0, 10); }
function revenuePath(
  organizationId: string,
  range: RevenueRange,
  customFrom = "",
  customTo = "",
  format: "json" | "csv" = "json",
) {
  const path = `/platform/revenue${format === "csv" ? ".csv" : ""}`;
  if (range === "custom") {
    if (!customFrom || !customTo || customFrom > customTo) return null;
    return `${path}?from=${encodeURIComponent(`${customFrom}T00:00:00.000Z`)}&to=${encodeURIComponent(`${customTo}T23:59:59.999Z`)}&organizationId=${encodeURIComponent(organizationId)}`;
  }
  const to = new Date();
  const from =
    range === 1
      ? new Date(to.getFullYear(), to.getMonth(), to.getDate())
      : new Date(to.getTime() - range * 86_400_000);
  return `${path}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&organizationId=${encodeURIComponent(organizationId)}`;
}

export default function AttendMaster() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(
    null,
  );
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [revenueRangeKey, setRevenueRangeKey] = useState<RevenueRange>(30);
  const [customFrom, setCustomFrom] = useState(() => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 30); return dateInputValue(date); });
  const [customTo, setCustomTo] = useState(() => dateInputValue(new Date()));
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [organizationDraft, setOrganizationDraft] =
    useState<OrganizationDraft | null>(null);
  const [organizationCreateDraft, setOrganizationCreateDraft] =
    useState<OrganizationCreateDraft | null>(null);
  const [ticketFeeAgreementDraft, setTicketFeeAgreementDraft] =
    useState<TicketFeeAgreementDraft | null>(null);
  const [ticketFeeSettlementAsOf, setTicketFeeSettlementAsOf] = useState(() => dateInputValue(new Date()));
  const [ticketFeeRemittanceDueDate, setTicketFeeRemittanceDueDate] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 30);
    return dateInputValue(date);
  });
  const [locationDraft, setLocationDraft] = useState<{
    id: string;
    values: LocationDraft;
  } | null>(null);
  const [contentDraft, setContentDraft] = useState<{
    id: string;
    values: CinemaContent;
  } | null>(null);
  const [cinemaManagerDraft, setCinemaManagerDraft] =
    useState<CinemaManagerDraft | null>(null);
  const [auditoriumDraft, setAuditoriumDraft] =
    useState<AuditoriumDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [locationCountFilter, setLocationCountFilter] = useState("ALL");
  const authRequestRef = useRef(0);

  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then((nextOverview) => { if (active) setOverview(nextOverview); })
      .catch((reason: unknown) =>
        active && setError(
          reason instanceof Error ? reason.message : "Could not load clients.",
        ),
      );
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setSelectedOrganizationId(null);
      beginOrganizationCreate();
      return;
    }
    const organizationId = params.get("organizationId");
    const connectAction = params.get("connect");
    if (!organizationId) return;
    setSelectedOrganizationId(organizationId);
    if (!connectAction) return;
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (connectAction === "refresh")
      void startConnectOnboarding(organizationId);
    if (connectAction === "return") void refreshConnectStatus(organizationId);
  }, [session]);

  useEffect(() => {
    if (!session || !selectedOrganizationId) {
      setOrganization(null);
      return;
    }
    let active = true;
    setOrganizationLoading(true);
    setError(null);
    request<OrganizationDetail>(
      `/platform/organizations/${selectedOrganizationId}`,
      undefined,
      session.accessToken,
    )
      .then((nextOrganization) => {
        if (!active) return;
        setOrganization(nextOrganization);
        const params = new URLSearchParams(window.location.search);
        const section = params.get("section");
        if (section !== "content" && section !== "branding" && section !== "staff" && section !== "auditorium") return;
        const locationId = params.get("locationId");
        const location =
          nextOrganization.locations.find((item) => item.id === locationId) ??
          nextOrganization.locations[0];
        if (location && section === "content")
          setContentDraft({
            id: location.id,
            values: structuredClone(location.content.draft),
          });
        if (location && section === "branding") beginLocationEdit(location);
        if (location && section === "staff")
          setCinemaManagerDraft({
            locationId: location.id,
            name: "",
            email: "",
            password: "",
          });
        if (location && section === "auditorium")
          setAuditoriumDraft({
            locationId: location.id,
            name: `Theater ${location.auditoriums.length + 1}`,
            seatingMode: nextOrganization.defaultSeatingMode,
            seatingStyle: "SINGLE",
            capacity: 96,
            rows: 8,
            seatsPerRow: 12,
            centerAisle: true,
            accessiblePairs: 1,
          });
        if (location)
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() =>
              document
                .querySelector(`[data-onboarding-section="${section}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            ),
          );
      })
      .catch((reason: unknown) =>
        active && setError(
          reason instanceof Error
            ? reason.message
            : "Could not load this cinema.",
        ),
      )
      .finally(() => { if (active) setOrganizationLoading(false); });
    return () => { active = false; };
  }, [selectedOrganizationId, session]);

  useEffect(() => {
    if (!session || !selectedOrganizationId) {
      setRevenue(null);
      return;
    }
    let active = true;
    const path = revenuePath(selectedOrganizationId, revenueRangeKey, customFrom, customTo);
    if (!path) return;
    setRevenueLoading(true);
    setError(null);
    request<RevenueReport>(
      path,
      undefined,
      session.accessToken,
    )
      .then((nextRevenue) => { if (active) setRevenue(nextRevenue); })
      .catch((reason: unknown) =>
        active && setError(
          reason instanceof Error
            ? reason.message
            : "Could not load client revenue.",
        ),
      )
      .finally(() => { if (active) setRevenueLoading(false); });
    return () => { active = false; };
  }, [selectedOrganizationId, session, revenueRangeKey, customFrom, customTo]);

  async function downloadClientRevenue() {
    if (!session || !selectedOrganizationId || !organization) return;
    const path = revenuePath(selectedOrganizationId, revenueRangeKey, customFrom, customTo, "csv");
    if (!path) return;
    setRevenueLoading(true);
    setError(null);
    try {
      const blob = await platformDownload(
        API_BASE_URL,
        STORAGE_KEY,
        path,
        session.accessToken,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${organization.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}-revenue-${revenueRangeKey === "custom" ? `${customFrom}-to-${customTo}` : `${revenueRangeKey}-day`}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not export client revenue.",
      );
    } finally {
      setRevenueLoading(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    const requestId = ++authRequestRef.current;
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (requestId !== authRequestRef.current) return;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) {
      if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed.");
    }
  }

  function signOut() {
    authRequestRef.current += 1;
    void revokePlatformSession(API_BASE_URL, session?.accessToken);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setOverview(null);
    setSelectedOrganizationId(null);
    setOrganization(null);
    setError(null);
  }

  function beginOrganizationEdit(detail: OrganizationDetail) {
    setOrganizationDraft({
      name: detail.name,
      legalName: detail.legalName ?? "",
      businessTypeLabel: detail.businessTypeLabel ?? "",
      defaultSeatingMode: detail.defaultSeatingMode,
      timezone: detail.timezone,
      ticketFee: (detail.ticketFeeMinor / 100).toFixed(2),
      registeredTicketFee: (detail.registeredTicketFeeMinor / 100).toFixed(2),
    });
  }

  function beginOrganizationCreate() {
    setOrganizationCreateDraft({
      name: "",
      legalName: "",
      businessTypeLabel: "Cinema",
      defaultSeatingMode: "RESERVED",
      timezone: "America/Chicago",
      locationName: "",
      address: "",
      locationTimezone: "America/Chicago",
    });
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session || !organizationCreateDraft) return;
    setSaving(true);
    setError(null);
    try {
      const values = organizationCreateDraft;
      const created = await request<OrganizationDetail>(
        "/platform/organizations",
        {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            legalName: values.legalName || null,
            businessTypeLabel: values.businessTypeLabel || null,
            defaultSeatingMode: values.defaultSeatingMode,
            timezone: values.timezone,
            location: {
              name: values.locationName,
              address: values.address || null,
              timezone: values.locationTimezone,
            },
          }),
        },
        session.accessToken,
      );
      const refreshed = await request<Overview>(
        "/platform/overview",
        undefined,
        session.accessToken,
      );
      setOverview(refreshed);
      setOrganizationCreateDraft(null);
      setSelectedOrganizationId(created.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not add organization.",
      );
    } finally {
      setSaving(false);
    }
  }

  function beginLocationEdit(location: LocationDetail) {
    const draft = location.brandingDraft?.values;
    setLocationDraft({
      id: location.id,
      values: {
        name: location.name,
        address: location.address ?? "",
        timezone: location.timezone,
        active: location.active,
        logoUrl: draft?.logoUrl ?? location.branding.logoUrl ?? "",
        accentColor: draft?.accentColor ?? location.branding.accentColor ?? "",
        accentMutedColor:
          draft?.accentMutedColor ?? location.branding.accentMutedColor ?? "",
        backgroundColor:
          draft?.backgroundColor ?? location.branding.backgroundColor ?? "",
        backgroundGlowColor:
          draft?.backgroundGlowColor ??
          location.branding.backgroundGlowColor ??
          "",
        surfaceColor:
          draft?.surfaceColor ?? location.branding.surfaceColor ?? "",
        textColor: draft?.textColor ?? location.branding.textColor ?? "",
        mutedTextColor:
          draft?.mutedTextColor ?? location.branding.mutedTextColor ?? "",
        adminAccentColor:
          draft?.adminAccentColor ?? location.adminBranding.accentColor ?? "",
        adminAccentMutedColor:
          draft?.adminAccentMutedColor ??
          location.adminBranding.accentMutedColor ??
          "",
        adminBackgroundColor:
          draft?.adminBackgroundColor ??
          location.adminBranding.backgroundColor ??
          "",
        adminSurfaceColor:
          draft?.adminSurfaceColor ?? location.adminBranding.surfaceColor ?? "",
        adminTextColor:
          draft?.adminTextColor ?? location.adminBranding.textColor ?? "",
        adminMutedTextColor:
          draft?.adminMutedTextColor ??
          location.adminBranding.mutedTextColor ??
          "",
        adminUi: draft?.adminUi ?? location.adminBranding.ui ?? adminUiDefaults,
        ...location.operations,
      },
    });
  }

  async function saveOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !organizationDraft) return;
    setSaving(true);
    setError(null);
    try {
      const { ticketFee, registeredTicketFee, ...draft } = organizationDraft;
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...draft,
            legalName: draft.legalName || null,
            businessTypeLabel: draft.businessTypeLabel || null,
            defaultSeatingMode: draft.defaultSeatingMode,
            ticketFeeMinor: Math.round(Number(ticketFee) * 100),
            registeredTicketFeeMinor: Math.round(Number(registeredTicketFee) * 100),
          }),
        },
        session.accessToken,
      );
      setOrganization(updated);
      setOrganizationDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save organization.",
      );
    } finally {
      setSaving(false);
    }
  }

  function beginTicketFeeAgreementCreate() {
    if (!organization) return;
    const customerFee = organization.ticketFeeMinor / 100;
    setTicketFeeAgreementDraft({
      name: `${organization.name} ticket-fee agreement`,
      customerFee: customerFee.toFixed(2),
      structure: "FLAT",
      thresholdPeriod: "CONTRACT_YEAR",
      effectiveFrom: dateInputValue(new Date()),
      thresholdTickets: "100000",
      firstPlatformShare: (customerFee / 2).toFixed(2),
      secondPlatformShare: (customerFee / 2).toFixed(2),
    });
  }

  async function createTicketFeeAgreement(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !ticketFeeAgreementDraft) return;
    const customerFeeMinor = Math.round(Number(ticketFeeAgreementDraft.customerFee) * 100);
    const threshold = Number(ticketFeeAgreementDraft.thresholdTickets);
    const firstPlatformShareMinor = Math.round(Number(ticketFeeAgreementDraft.firstPlatformShare) * 100);
    const secondPlatformShareMinor = Math.round(Number(ticketFeeAgreementDraft.secondPlatformShare) * 100);
    const isTiered = ticketFeeAgreementDraft.structure === "TIERED";
    if (!Number.isFinite(customerFeeMinor) || customerFeeMinor < 0 || !Number.isFinite(firstPlatformShareMinor) || firstPlatformShareMinor < 0 || firstPlatformShareMinor > customerFeeMinor || (isTiered && (!Number.isInteger(threshold) || threshold < 1 || !Number.isFinite(secondPlatformShareMinor) || secondPlatformShareMinor < 0 || secondPlatformShareMinor > customerFeeMinor))) {
      setError("Ringo's share must be between $0.00 and the customer fee, and volume tiers need a valid ticket threshold.");
      return;
    }
    const tiers = isTiered
      ? [
          { startsAtTicket: 1, endsAtTicket: threshold, platformShareMinor: firstPlatformShareMinor, operatorShareMinor: customerFeeMinor - firstPlatformShareMinor },
          { startsAtTicket: threshold + 1, endsAtTicket: null, platformShareMinor: secondPlatformShareMinor, operatorShareMinor: customerFeeMinor - secondPlatformShareMinor },
        ]
      : [{ startsAtTicket: 1, endsAtTicket: null, platformShareMinor: firstPlatformShareMinor, operatorShareMinor: customerFeeMinor - firstPlatformShareMinor }];
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/ticket-fee-agreements`,
        {
          method: "POST",
          body: JSON.stringify({
            name: ticketFeeAgreementDraft.name,
            customerFeeMinor,
            thresholdPeriod: ticketFeeAgreementDraft.thresholdPeriod,
            effectiveFrom: `${ticketFeeAgreementDraft.effectiveFrom}T00:00:00.000Z`,
            tiers,
          }),
        },
        session.accessToken,
      );
      const refreshed = await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken);
      setOrganization(refreshed);
      setTicketFeeAgreementDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create ticket-fee agreement.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadTicketFeeSettlement() {
    if (!session || !organization) return;
    setError(null);
    try {
      const asOf = encodeURIComponent(`${ticketFeeSettlementAsOf}T23:59:59.999Z`);
      const blob = await platformDownload(API_BASE_URL, STORAGE_KEY, `/platform/organizations/${organization.id}/ticket-fee-settlement.csv?asOf=${asOf}`, session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${organization.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-ticket-fee-settlement.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export the ticket-fee settlement.");
    }
  }

  async function loadTicketFeeSettlement() {
    if (!session || !organization) return;
    setSaving(true);
    setError(null);
    try {
      const asOf = encodeURIComponent(`${ticketFeeSettlementAsOf}T23:59:59.999Z`);
      const settlement = await request<OrganizationDetail["ticketFeeSettlement"]>(`/platform/organizations/${organization.id}/ticket-fee-settlement?asOf=${asOf}`, undefined, session.accessToken);
      setOrganization({ ...organization, ticketFeeSettlement: settlement });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the ticket-fee settlement.");
    } finally {
      setSaving(false);
    }
  }

  async function finalizeTicketFeeRemittance() {
    if (!session || !organization || !organization.ticketFeeSettlement) return;
    if (!window.confirm("Finalize this completed settlement period? Its financial snapshot cannot be changed later.")) return;
    setSaving(true);
    setError(null);
    try {
      await request(`/platform/organizations/${organization.id}/ticket-fee-remittances`, {
        method: "POST",
        body: JSON.stringify({
          asOf: `${ticketFeeSettlementAsOf}T23:59:59.999Z`,
          dueDate: ticketFeeRemittanceDueDate ? `${ticketFeeRemittanceDueDate}T23:59:59.999Z` : null,
        }),
      }, session.accessToken);
      setOrganization(await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not finalize the ticket-fee remittance.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTicketFeeRemittance(remittanceId: string, status: "PAID" | "VOID") {
    if (!session || !organization) return;
    const paymentReference = status === "PAID" ? window.prompt("Payment reference (ACH, check, or transfer ID)") : null;
    if (status === "PAID" && paymentReference === null) return;
    if (status === "VOID" && !window.confirm("Void this remittance? The original financial snapshot will remain in the audit trail.")) return;
    setSaving(true);
    setError(null);
    try {
      await request(`/platform/ticket-fee-remittances/${remittanceId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, paymentReference: paymentReference || null }),
      }, session.accessToken);
      setOrganization(await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the ticket-fee remittance.");
    } finally {
      setSaving(false);
    }
  }

  async function editTicketFeeRemittanceNotes(remittanceId: string, status: "DUE" | "PAID" | "VOID", existingNotes: string | null) {
    if (!session || !organization) return;
    const notes = window.prompt("Collection notes", existingNotes ?? "");
    if (notes === null || notes === (existingNotes ?? "")) return;
    setSaving(true);
    setError(null);
    try {
      await request(`/platform/ticket-fee-remittances/${remittanceId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes: notes.trim() || null }),
      }, session.accessToken);
      setOrganization(await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the collection notes.");
    } finally {
      setSaving(false);
    }
  }

  async function logTicketFeeRemittanceContact(remittanceId: string, existingNotes: string | null) {
    if (!session || !organization) return;
    const notes = window.prompt("Collection contact notes", existingNotes ?? "");
    if (notes === null) return;
    const followUpDate = window.prompt("Next follow-up date (YYYY-MM-DD), or leave blank", "");
    if (followUpDate === null) return;
    setSaving(true);
    setError(null);
    try {
      await request(`/platform/ticket-fee-remittances/${remittanceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "DUE",
          notes: notes.trim() || null,
          lastContactedAt: new Date().toISOString(),
          nextFollowUpAt: followUpDate.trim() ? `${followUpDate.trim()}T23:59:59.999Z` : null,
          collectionOwnerId: session.user.id,
        }),
      }, session.accessToken);
      setOrganization(await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not log the collection contact.");
    } finally {
      setSaving(false);
    }
  }

  async function assignTicketFeeRemittanceToMe(remittanceId: string) {
    if (!session || !organization) return;
    setSaving(true);
    setError(null);
    try {
      await request(`/platform/ticket-fee-remittances/${remittanceId}`, {
        method: "PATCH",
        body: JSON.stringify({ collectionOwnerId: session.user.id }),
      }, session.accessToken);
      setOrganization(await request<OrganizationDetail>(`/platform/organizations/${organization.id}`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not assign the remittance.");
    } finally {
      setSaving(false);
    }
  }

  async function setOrganizationActive(active: boolean) {
    if (!session || !organization) return;
    const action = active ? "reactivate" : "suspend";
    if (
      !window.confirm(
        active
          ? `Reactivate ${organization.name}? Cinema staff and customers will regain access to active locations.`
          : `Suspend ${organization.name}? Cinema staff sessions will be revoked and customer access will stop across every location.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}`,
        { method: "PATCH", body: JSON.stringify({ active }) },
        session.accessToken,
      );
      const refreshed = await request<Overview>(
        "/platform/overview",
        undefined,
        session.accessToken,
      );
      setOrganization(updated);
      setOverview(refreshed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : `Could not ${action} organization.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrganization() {
    if (!session || !organization || organization.active) return;
    const confirmation = window.prompt(
      `Permanently delete ${organization.name}? This only succeeds for empty test clients. Type the exact client name to continue.`,
    );
    if (confirmation !== organization.name) return;
    setSaving(true);
    setError(null);
    try {
      await request<{ deleted: true }>(
        `/platform/organizations/${organization.id}`,
        { method: "DELETE" },
        session.accessToken,
      );
      const refreshed = await request<Overview>(
        "/platform/overview",
        undefined,
        session.accessToken,
      );
      setOverview(refreshed);
      setSelectedOrganizationId(null);
      setOrganization(null);
      setOrganizationDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not delete client.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function startConnectOnboarding(organizationId = organization?.id) {
    if (!session || !organizationId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await request<{ url: string }>(
        `/platform/organizations/${organizationId}/connect/onboarding-link`,
        {
          method: "POST",
          body: JSON.stringify({
            origin: window.location.origin,
            returnPath: "/clients",
          }),
        },
        session.accessToken,
      );
      window.location.assign(result.url);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not start Stripe onboarding.",
      );
      setSaving(false);
    }
  }

  async function refreshConnectStatus(organizationId = organization?.id) {
    if (!session || !organizationId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organizationId}/connect/refresh`,
        { method: "POST" },
        session.accessToken,
      );
      const refreshed = await request<Overview>(
        "/platform/overview",
        undefined,
        session.accessToken,
      );
      setOrganization(updated);
      setOverview(refreshed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not refresh Stripe onboarding status.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !locationDraft) return;
    const values = locationDraft.values;
    const nullable = (value: string) => value || null;
    setSaving(true);
    setError(null);
    try {
      const locationPayload = {
        name: values.name,
        address: nullable(values.address),
        timezone: values.timezone,
        active: values.active,
        ticketTaxRateBasisPoints: values.ticketTaxRateBasisPoints,
        preShowBufferMinutes: values.preShowBufferMinutes,
        cleaningBufferMinutes: values.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: values.checkDropMinutesBeforeEnd,
        autoSettleGraceMinutes: values.autoSettleGraceMinutes,
        timeClockEnabled: values.timeClockEnabled,
      };
      const brandingPayload = {
        logoUrl: nullable(values.logoUrl),
        accentColor: nullable(values.accentColor),
        accentMutedColor: nullable(values.accentMutedColor),
        backgroundColor: nullable(values.backgroundColor),
        backgroundGlowColor: nullable(values.backgroundGlowColor),
        surfaceColor: nullable(values.surfaceColor),
        textColor: nullable(values.textColor),
        mutedTextColor: nullable(values.mutedTextColor),
        adminAccentColor: nullable(values.adminAccentColor),
        adminAccentMutedColor: nullable(values.adminAccentMutedColor),
        adminBackgroundColor: nullable(values.adminBackgroundColor),
        adminSurfaceColor: nullable(values.adminSurfaceColor),
        adminTextColor: nullable(values.adminTextColor),
        adminMutedTextColor: nullable(values.adminMutedTextColor),
        adminUi: values.adminUi,
      };
      await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}/locations/${locationDraft.id}`,
        { method: "PATCH", body: JSON.stringify(locationPayload) },
        session.accessToken,
      );
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}/locations/${locationDraft.id}/branding/draft`,
        { method: "PATCH", body: JSON.stringify(brandingPayload) },
        session.accessToken,
      );
      setOrganization(updated);
      setLocationDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save location.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publishBranding(location: LocationDetail) {
    if (!session || !organization) return;
    if (
      !window.confirm(
        `Publish the branding draft for ${location.name}? This immediately updates the live customer and cinema-admin experiences.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}/locations/${location.id}/branding/publish`,
        { method: "POST" },
        session.accessToken,
      );
      setOrganization(updated);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not publish branding.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openSupportSession(location: LocationDetail) {
    if (!session || !organization) return;
    if (
      !window.confirm(
        `Open ${location.name} in a 15-minute read-only support session? The session is visibly bannered and audited.`,
      )
    )
      return;
    const supportWindow = window.open("about:blank", "_blank");
    if (!supportWindow) {
      setError(
        "Your browser blocked the support tab. Allow pop-ups for Ringo Master and try again.",
      );
      return;
    }
    supportWindow.opener = null;
    setSaving(true);
    setError(null);
    try {
      const support = await request<{ accessToken: string }>(
        `/platform/organizations/${organization.id}/locations/${location.id}/support-session`,
        { method: "POST" },
        session.accessToken,
      );
      supportWindow.location.href = `${CINEMA_ADMIN_URL}/#support=${encodeURIComponent(support.accessToken)}`;
    } catch (reason) {
      supportWindow.close();
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not open read-only support.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveContentDraft(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !contentDraft) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}/locations/${contentDraft.id}/content/draft`,
        { method: "PATCH", body: JSON.stringify(contentDraft.values) },
        session.accessToken,
      );
      setOrganization(updated);
      setContentDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save content draft.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publishContent(location: LocationDetail) {
    if (!session || !organization) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}/locations/${location.id}/content/publish`,
        { method: "POST" },
        session.accessToken,
      );
      setOrganization(updated);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not publish content.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createCinemaManager(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !cinemaManagerDraft) return;
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/locations/${cinemaManagerDraft.locationId}/cinema-manager`,
        {
          method: "POST",
          body: JSON.stringify({
            name: cinemaManagerDraft.name,
            email: cinemaManagerDraft.email,
            password: cinemaManagerDraft.password,
          }),
        },
        session.accessToken,
      );
      const updated = await request<OrganizationDetail>(
        `/platform/organizations/${organization.id}`,
        undefined,
        session.accessToken,
      );
      const refreshed = await request<Overview>(
        "/platform/overview",
        undefined,
        session.accessToken,
      );
      setOrganization(updated);
      setOverview(refreshed);
      setCinemaManagerDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the cinema manager.",
      );
    } finally {
      setSaving(false);
    }
  }

  function auditoriumSeats(draft: AuditoriumDraft): SeatInput[] {
    if (draft.sourceSeats) return draft.sourceSeats;
    return Array.from({ length: draft.rows }, (_, rowIndex) => {
      const rowLabel = String.fromCharCode(65 + rowIndex);
      return Array.from({ length: draft.seatsPerRow }, (_, seatIndex) => {
        const number = seatIndex + 1;
        const accessibleIndex = rowIndex === draft.rows - 1 ? seatIndex : -1;
        const isAccessiblePosition =
          accessibleIndex >= 0 && accessibleIndex < draft.accessiblePairs * 2;
        return {
          label: `${rowLabel}${number}`,
          rowLabel,
          number,
          x:
            seatIndex +
            (draft.centerAisle && seatIndex >= Math.ceil(draft.seatsPerRow / 2)
              ? 1
              : 0),
          y: rowIndex,
          type: isAccessiblePosition
            ? accessibleIndex % 2 === 0
              ? "ADA"
              : "COMPANION"
            : "STANDARD",
          levelKey: "main",
        } satisfies SeatInput;
      });
    }).flat();
  }

  function auditoriumLayout(draft: AuditoriumDraft): SeatMapLayout {
    if (draft.sourceLayout) return { ...draft.sourceLayout, seatingStyle: draft.seatingStyle };
    const aisleX = Math.ceil(draft.seatsPerRow / 2);
    return {
      mode: "BASIC",
      canvas: {
        width: draft.seatsPerRow + (draft.centerAisle ? 1 : 0),
        height: draft.rows,
      },
      screenPosition: "TOP",
      seatingStyle: draft.seatingStyle,
      levels: [
        {
          id: "main",
          name: "Main floor",
          sortOrder: 0,
          elevationLabel: "Floor",
        },
      ],
      sections: [],
      elements: draft.centerAisle
        ? [
            {
              id: "center-aisle",
              type: "AISLE",
              levelId: "main",
              x: aisleX,
              y: 0,
              width: 1,
              height: draft.rows,
              label: "Center aisle",
              orientation: "VERTICAL",
            },
          ]
        : [],
    };
  }

  async function saveAuditorium(event: FormEvent) {
    event.preventDefault();
    if (!session || !organization || !auditoriumDraft) return;
    if (auditoriumDraft.seatingMode === "RESERVED") {
      const layoutResult = seatMapLayoutSchema.safeParse(
        auditoriumLayout(auditoriumDraft),
      );
      if (!layoutResult.success) {
        const issue = layoutResult.error.issues[0];
        const field = issue?.path.join(".") ?? "layout";
        setError(
          `${field}: ${issue?.message ?? "The layout is invalid."} Reserved auditoriums require at least 8 rows and a layout 12 spaces wide.`,
        );
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/locations/${auditoriumDraft.locationId}/auditoriums${auditoriumDraft.id ? `/${auditoriumDraft.id}` : ""}`,
        {
          method: auditoriumDraft.id ? "PATCH" : "POST",
          body: JSON.stringify(
            auditoriumDraft.seatingMode === "GENERAL_ADMISSION"
              ? {
                  name: auditoriumDraft.name,
                  seatingMode: auditoriumDraft.seatingMode,
                  capacity: auditoriumDraft.capacity,
                }
              : {
                  name: auditoriumDraft.name,
                  seatingMode: auditoriumDraft.seatingMode,
                  seatMapName: `${auditoriumDraft.name} layout`,
                  seats: auditoriumSeats(auditoriumDraft),
                  layout: auditoriumLayout(auditoriumDraft),
                },
          ),
        },
        session.accessToken,
      );
      const [updated, refreshed] = await Promise.all([
        request<OrganizationDetail>(
          `/platform/organizations/${organization.id}`,
          undefined,
          session.accessToken,
        ),
        request<Overview>("/platform/overview", undefined, session.accessToken),
      ]);
      setOrganization(updated);
      setOverview(refreshed);
      setAuditoriumDraft(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the auditorium.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteAuditorium(
    locationId: string,
    auditoriumId: string,
    name: string,
  ) {
    if (
      !session ||
      !organization ||
      !window.confirm(
        `Permanently delete ${name}? This is only allowed when it has no showtime history.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/locations/${locationId}/auditoriums/${auditoriumId}`,
        { method: "DELETE" },
        session.accessToken,
      );
      const [updated, refreshed] = await Promise.all([
        request<OrganizationDetail>(
          `/platform/organizations/${organization.id}`,
          undefined,
          session.accessToken,
        ),
        request<Overview>("/platform/overview", undefined, session.accessToken),
      ]);
      setOrganization(updated);
      setOverview(refreshed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the auditorium.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function duplicateAuditorium(
    location: LocationDetail,
    auditorium: LocationDetail["auditoriums"][number],
  ) {
    if (!session || !organization) return;
    const name = window
      .prompt(`Name the copy of ${auditorium.name}:`, `${auditorium.name} copy`)
      ?.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/locations/${location.id}/auditoriums/${auditorium.id}/duplicate`,
        { method: "POST", body: JSON.stringify({ name }) },
        session.accessToken,
      );
      const [updated, refreshed] = await Promise.all([
        request<OrganizationDetail>(
          `/platform/organizations/${organization.id}`,
          undefined,
          session.accessToken,
        ),
        request<Overview>("/platform/overview", undefined, session.accessToken),
      ]);
      setOrganization(updated);
      setOverview(refreshed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not duplicate the auditorium.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivateAuditorium(
    location: LocationDetail,
    auditorium: LocationDetail["auditoriums"][number],
  ) {
    if (
      !session ||
      !organization ||
      !window.confirm(
        `Deactivate ${auditorium.name}? This is blocked while future showtimes still use the room.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      await request(
        `/platform/organizations/${organization.id}/locations/${location.id}/auditoriums/${auditorium.id}/deactivate`,
        { method: "PATCH" },
        session.accessToken,
      );
      const [updated, refreshed] = await Promise.all([
        request<OrganizationDetail>(
          `/platform/organizations/${organization.id}`,
          undefined,
          session.accessToken,
        ),
        request<Overview>("/platform/overview", undefined, session.accessToken),
      ]);
      setOrganization(updated);
      setOverview(refreshed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not deactivate the auditorium.",
      );
    } finally {
      setSaving(false);
    }
  }

  const locations =
    overview?.organizations.flatMap((item) => item.locations) ?? [];
  const filteredOrganizations = useMemo(() => {
    const normalizedQuery = clientQuery.trim().toLowerCase();
    return (overview?.organizations ?? []).filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          item.name,
          item.legalName ?? "",
          item.businessTypeLabel ?? "",
          item.timezone,
          ...item.locations.flatMap((location) => [
            location.name,
            location.address ?? "",
            location.timezone,
          ]),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesPayment =
        paymentFilter === "ALL" ||
        (paymentFilter === "COMPLETE" &&
          item.payments.onboardingStatus === "COMPLETE") ||
        (paymentFilter === "INCOMPLETE" &&
          item.payments.onboardingStatus !== "COMPLETE") ||
        item.payments.onboardingStatus === paymentFilter;
      const matchesLocation =
        locationFilter === "ALL" ||
        item.locations.some(
          (location) => location.active === (locationFilter === "ACTIVE"),
        );
      const matchesLocationCount =
        locationCountFilter === "ALL" ||
        (locationCountFilter === "ONE" && item.locations.length === 1) ||
        (locationCountFilter === "MULTIPLE" && item.locations.length > 1);
      return (
        matchesQuery &&
        matchesPayment &&
        matchesLocation &&
        matchesLocationCount
      );
    });
  }, [
    clientQuery,
    locationCountFilter,
    locationFilter,
    overview,
    paymentFilter,
  ]);

  function exportClientDirectory() {
    const headers = [
      "Client",
      "Legal name",
      "Business type",
      "Timezone",
      "Active",
      "Default admission model",
      "Stripe connected",
      "Stripe onboarding status",
      "Locations",
      "Active locations",
      "Auditoriums",
      "Employees",
      "Menu items",
      "Upcoming showtimes",
    ];
    const rows = filteredOrganizations.map((item) => [
      item.name,
      item.legalName ?? "",
      item.businessTypeLabel ?? "",
      item.timezone,
      item.active,
      item.defaultSeatingMode,
      item.payments.connected,
      item.payments.onboardingStatus,
      item.locations.length,
      item.locations.filter((location) => location.active).length,
      item.locations.reduce((sum, location) => sum + location.configuration.auditoriums, 0),
      item.locations.reduce((sum, location) => sum + location.configuration.employees, 0),
      item.locations.reduce((sum, location) => sum + location.configuration.menuItems, 0),
      item.locations.reduce((sum, location) => sum + location.configuration.upcomingShowtimes, 0),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ringo-master-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!restored)
    return (
      <main className="center">
        <p>Loading Ringo Master…</p>
      </main>
    );
  if (!session)
    return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow platform-master-label" />
          <h1>
            {selectedOrganizationId ? "Cinema profile" : "Client operations"}
          </h1>
          <p className="muted">
            Company visibility across cinema clients. Cinema staff retain
            control of their own operations.
          </p>
        </div>
        <div className="identity">
          {!selectedOrganizationId && (
            <button className="quiet" onClick={beginOrganizationCreate}>
              + Add organization
            </button>
          )}
          <span>{session.user.name}</span>
          <button className="quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <PlatformNav role={session.user.role} />
      {error && <div className="error">{error}</div>}
      {!selectedOrganizationId && organizationCreateDraft && (
        <form
          className="editor create-organization"
          onSubmit={createOrganization}
        >
          <div className="editor-heading">
            <div>
              <p className="eyebrow">NEW CLIENT</p>
              <h2>Add organization</h2>
              <p className="muted">
                Create the cinema company or chain and its first operating
                location. More locations can be added later.
              </p>
            </div>
            <button
              type="button"
              className="quiet"
              onClick={() => setOrganizationCreateDraft(null)}
            >
              Cancel
            </button>
          </div>
          <div className="form-grid">
            <label>
              Organization name
              <input
                required
                value={organizationCreateDraft.name}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    name: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Legal name
              <input
                value={organizationCreateDraft.legalName}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    legalName: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Business type label
              <input
                placeholder="Cinema, concert venue, festival…"
                value={organizationCreateDraft.businessTypeLabel}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    businessTypeLabel: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Organization timezone
              <input
                required
                value={organizationCreateDraft.timezone}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    timezone: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Default admission model
              <select
                value={organizationCreateDraft.defaultSeatingMode}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    defaultSeatingMode: event.target.value as
                      | "RESERVED"
                      | "GENERAL_ADMISSION",
                  })
                }
              >
                <option value="RESERVED">Reserved seating</option>
                <option value="GENERAL_ADMISSION">General admission</option>
              </select>
              <small className="muted">
                Used for new auditoriums. Existing auditoriums are unchanged.
              </small>
            </label>
            <label>
              First cinema name
              <input
                required
                value={organizationCreateDraft.locationName}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    locationName: event.target.value,
                  })
                }
              />
            </label>
            <label>
              First cinema address
              <input
                value={organizationCreateDraft.address}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    address: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Cinema timezone
              <input
                required
                value={organizationCreateDraft.locationTimezone}
                onChange={(event) =>
                  setOrganizationCreateDraft({
                    ...organizationCreateDraft,
                    locationTimezone: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <button disabled={saving}>
            {saving ? "Creating…" : "Create organization and first cinema"}
          </button>
        </form>
      )}
      {selectedOrganizationId && (
        <section className="detail-shell">
          <button
            className="back"
            onClick={() => setSelectedOrganizationId(null)}
          >
            ← All cinema clients
          </button>
          {organizationLoading && (
            <p className="muted">Loading cinema profile…</p>
          )}
          {organization && (
            <>
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">ORGANIZATION</p>
                  <h2>{organization.name}</h2>
                  <span
                    className={
                      organization.active ? "status good" : "status warning"
                    }
                  >
                    {organization.active ? "Active client" : "Suspended client"}
                  </span>
                  <p className="muted">
                    {organization.businessTypeLabel ??
                      "Business type not classified"}{" "}
                    · {organization.legalName ?? "Legal name not configured"} ·
                    Client since{" "}
                    {new Date(organization.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="org-actions">
                  <span
                    className={
                      organization.payments.onboardingStatus === "COMPLETE"
                        ? "status good"
                        : "status warning"
                    }
                  >
                    {organization.payments.connected
                      ? `Payments ${organization.payments.onboardingStatus.toLowerCase()}`
                      : `Payments ${organization.payments.onboardingStatus.toLowerCase().replaceAll("_", " ")}`}
                  </span>
                  {organization.payments.onboardingStatus !== "COMPLETE" && (
                    <button
                      className="edit-button"
                      disabled={saving}
                      onClick={() => void startConnectOnboarding()}
                    >
                      {organization.payments.connected
                        ? "Continue Stripe onboarding"
                        : "Connect Stripe"}
                    </button>
                  )}
                  {organization.payments.connected && (
                    <button
                      className="quiet"
                      disabled={saving}
                      onClick={() => void refreshConnectStatus()}
                    >
                      Refresh payment status
                    </button>
                  )}
                  <button
                    className="edit-button"
                    onClick={() => beginOrganizationEdit(organization)}
                  >
                    Edit organization
                  </button>
                  {session.user.role !== "VIEWER" && (
                    <button
                      className={organization.active ? "quiet" : "edit-button"}
                      disabled={saving}
                      onClick={() =>
                        void setOrganizationActive(!organization.active)
                      }
                    >
                      {organization.active
                        ? "Suspend client"
                        : "Reactivate client"}
                    </button>
                  )}
                  {session.user.role !== "VIEWER" && !organization.active && (
                    <button
                      className="danger"
                      disabled={saving}
                      onClick={() => void deleteOrganization()}
                    >
                      Delete empty client
                    </button>
                  )}
                </div>
              </div>
              <section className="client-health-panel">
                <div><p className="eyebrow">OPERATOR HEALTH</p><h3>Live operational state</h3><p className="muted">Last completed payment: {organization.health.lastSuccessfulPaymentAt ? new Date(organization.health.lastSuccessfulPaymentAt).toLocaleString() : "none recorded"}</p></div>
                <div><div className="client-health-trends"><span><small>Payment failure · 7d</small><strong>{healthRate(organization.health.trends.paymentFailure.current.ratePercent)}</strong><em>{organization.health.trends.paymentFailure.current.failed} failed of {organization.health.trends.paymentFailure.current.total} attempts · prior 7d {healthRate(organization.health.trends.paymentFailure.previous.ratePercent)}</em></span><span><small>Refund rate · 7d</small><strong>{healthRate(organization.health.trends.refunds.current.ratePercent)}</strong><em>{money(organization.health.trends.refunds.current.refundedCents)} of {money(organization.health.trends.refunds.current.capturedCents)} captured · prior 7d {healthRate(organization.health.trends.refunds.previous.ratePercent)}</em></span></div><div className="client-health-metrics"><span><strong>{organization.health.failedPayments24h}</strong>Failed payments · 24h</span><span><strong>{organization.health.processingPayments}</strong>Processing now</span><span><strong>{organization.health.verificationReviews}</strong>Payment reviews</span><span><strong>{organization.health.failedRefunds}</strong>Failed refunds</span><span><strong>{organization.health.stalePayments}</strong>Stale payments</span><span><strong>{organization.health.staleRefunds}</strong>Stale refunds</span><span><strong>{organization.health.managerReviewTabs}</strong>Manager-review tabs</span><span><strong>{organization.health.expiredHoldBacklog}</strong>Expired holds</span></div></div>
              </section>
              {organizationDraft && (
                <form className="editor" onSubmit={saveOrganization}>
                  <div className="editor-heading">
                    <div>
                      <p className="eyebrow">COMPANY SETTINGS</p>
                      <h3>Edit organization</h3>
                    </div>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setOrganizationDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      Name
                      <input
                        required
                        value={organizationDraft.name}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Legal name
                      <input
                        value={organizationDraft.legalName}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            legalName: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Business type label
                      <input
                        placeholder="Cinema, concert venue, festival…"
                        value={organizationDraft.businessTypeLabel}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            businessTypeLabel: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Timezone
                      <input
                        required
                        value={organizationDraft.timezone}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            timezone: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Default admission model
                      <select
                        value={organizationDraft.defaultSeatingMode}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            defaultSeatingMode: event.target.value as
                              | "RESERVED"
                              | "GENERAL_ADMISSION",
                          })
                        }
                      >
                        <option value="RESERVED">Reserved seating</option>
                        <option value="GENERAL_ADMISSION">General admission</option>
                      </select>
                      <small className="muted">
                        Used for new auditoriums. Existing auditoriums are unchanged.
                      </small>
                    </label>
                    <label>
                      Guest service fee per ticket
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={organizationDraft.ticketFee}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            ticketFee: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Registered-customer service fee per ticket
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={organizationDraft.registeredTicketFee}
                        onChange={(event) =>
                          setOrganizationDraft({
                            ...organizationDraft,
                            registeredTicketFee: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="form-note">
                    Service fees are controlled by Ringo and apply to every
                    ticket group for this client. Keep both amounts equal when
                    the cinema does not distinguish guests from registered customers.
                  </p>
                  <button disabled={saving}>
                    {saving ? "Saving…" : "Save organization"}
                  </button>
                </form>
              )}
              <section className="dashboard-panel commercial-terms-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">COMMERCIAL TERMS</p>
                    <h3>Ticket-fee agreement</h3>
                    <p className="muted">Define how the customer fee is divided between Ringo and this operator as ticket volume grows. New versions preserve prior settlement terms.</p>
                  </div>
                  <div className="panel-actions"><label className="statement-date">Statement as of<input type="date" value={ticketFeeSettlementAsOf} onChange={(event) => setTicketFeeSettlementAsOf(event.target.value)} /></label><button className="quiet" disabled={saving} onClick={() => void loadTicketFeeSettlement()}>View period</button>{organization.ticketFeeSettlement && <button className="quiet" onClick={() => void downloadTicketFeeSettlement()}>Export statement</button>}{session.user.role !== "VIEWER" && !ticketFeeAgreementDraft && <button onClick={beginTicketFeeAgreementCreate}>{organization.ticketFeeAgreements.length ? "Add future version" : "Create agreement"}</button>}</div>
                </div>
                {ticketFeeAgreementDraft && <form className="editor commercial-terms-editor" onSubmit={createTicketFeeAgreement}>
                  <div className="editor-heading"><div><p className="eyebrow">NEW VERSION</p><h4>Commercial agreement</h4></div><button type="button" className="quiet" onClick={() => setTicketFeeAgreementDraft(null)}>Cancel</button></div>
                  <div className="form-grid">
                    <label>Agreement name<input required value={ticketFeeAgreementDraft.name} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, name: event.target.value })} /></label>
                    <label>Effective date<input required type="date" value={ticketFeeAgreementDraft.effectiveFrom} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, effectiveFrom: event.target.value })} /></label>
                    <label>Customer fee per ticket<input required type="number" min="0" step="0.01" value={ticketFeeAgreementDraft.customerFee} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, customerFee: event.target.value })} /></label>
                    <label>Agreement structure<select value={ticketFeeAgreementDraft.structure} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, structure: event.target.value as TicketFeeAgreementDraft["structure"] })}><option value="FLAT">Flat split — same amount for every ticket</option><option value="TIERED">Volume tiers — amount changes after a threshold</option></select></label>
                    {ticketFeeAgreementDraft.structure === "TIERED" && <>
                      <label>Volume resets<select value={ticketFeeAgreementDraft.thresholdPeriod} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, thresholdPeriod: event.target.value as TicketFeeAgreementDraft["thresholdPeriod"] })}><option value="CONTRACT_YEAR">Each contract year</option><option value="CALENDAR_YEAR">Each calendar year</option><option value="LIFETIME">Never (lifetime volume)</option></select></label>
                      <label>First tier ends after<input required type="number" min="1" step="1" value={ticketFeeAgreementDraft.thresholdTickets} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, thresholdTickets: event.target.value })} /><small className="muted">Net paid tickets</small></label>
                    </>}
                    <label>{ticketFeeAgreementDraft.structure === "TIERED" ? "Ringo share · first tier" : "Ringo share per ticket"}<input required type="number" min="0" step="0.01" value={ticketFeeAgreementDraft.firstPlatformShare} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, firstPlatformShare: event.target.value })} /><small className="muted">Operator receives the remainder of the customer fee.</small></label>
                    {ticketFeeAgreementDraft.structure === "TIERED" && <label>Ringo share · after threshold<input required type="number" min="0" step="0.01" value={ticketFeeAgreementDraft.secondPlatformShare} onChange={(event) => setTicketFeeAgreementDraft({ ...ticketFeeAgreementDraft, secondPlatformShare: event.target.value })} /><small className="muted">Continues without an upper limit.</small></label>}
                  </div>
                  <div className="agreement-split-preview">
                    <p className="eyebrow">PER-TICKET SPLIT PREVIEW</p>
                    <div><span>Customer pays</span><strong>{money(currencyInputCents(ticketFeeAgreementDraft.customerFee))}</strong></div>
                    <div><span>{ticketFeeAgreementDraft.structure === "TIERED" ? "Ringo · first tier" : "Ringo receives"}</span><strong>{money(currencyInputCents(ticketFeeAgreementDraft.firstPlatformShare))}</strong></div>
                    <div><span>{ticketFeeAgreementDraft.structure === "TIERED" ? "Operator · first tier" : "Operator receives"}</span><strong>{money(Math.max(0, currencyInputCents(ticketFeeAgreementDraft.customerFee) - currencyInputCents(ticketFeeAgreementDraft.firstPlatformShare)))}</strong></div>
                    {ticketFeeAgreementDraft.structure === "TIERED" && <><div><span>Ringo · after threshold</span><strong>{money(currencyInputCents(ticketFeeAgreementDraft.secondPlatformShare))}</strong></div><div><span>Operator · after threshold</span><strong>{money(Math.max(0, currencyInputCents(ticketFeeAgreementDraft.customerFee) - currencyInputCents(ticketFeeAgreementDraft.secondPlatformShare)))}</strong></div></>}
                  </div>
                  <p className="form-note">Creating this version closes the previous agreement at the new effective date. Existing versions cannot be edited retroactively.</p>
                  <button disabled={saving}>{saving ? "Creating…" : "Create agreement version"}</button>
                </form>}
                {!organization.ticketFeeAgreements.length && !ticketFeeAgreementDraft && <p className="dashboard-empty">No commercial ticket-fee agreement has been recorded. Customer fees are currently reported entirely as Ringo fee revenue.</p>}
                {organization.ticketFeeSettlement && <div className="agreement-settlement">
                  <div><small>Net paid tickets</small><strong>{organization.ticketFeeSettlement.tickets.toLocaleString()}</strong><em>{new Date(organization.ticketFeeSettlement.periodFrom).toLocaleDateString()} – {organization.ticketFeeSettlement.periodTo ? new Date(organization.ticketFeeSettlement.periodTo).toLocaleDateString() : "lifetime"}</em></div>
                  <div><small>Fees collected</small><strong>{money(organization.ticketFeeSettlement.collectedFeeCents)}</strong><em>{organization.ticketFeeSettlement.varianceCents === 0 ? "Reconciled to agreement" : `${money(organization.ticketFeeSettlement.varianceCents)} variance`}</em></div>
                  <div><small>Ringo accrued share</small><strong>{money(organization.ticketFeeSettlement.platformShareCents)}</strong><em>{money(organization.ticketFeeSettlement.activeTier.platformShareMinor)} per ticket in current tier</em></div>
                  <div><small>Operator accrued share</small><strong>{money(organization.ticketFeeSettlement.operatorShareCents)}</strong><em>{money(organization.ticketFeeSettlement.activeTier.operatorShareMinor)} per ticket in current tier</em></div>
                  <div><small>Current tier</small><strong>{organization.ticketFeeSettlement.activeTier.startsAtTicket.toLocaleString()}–{organization.ticketFeeSettlement.activeTier.endsAtTicket?.toLocaleString() ?? "∞"}</strong><em>{organization.ticketFeeSettlement.activeTier.ticketsRemaining === null ? "Final tier" : `${organization.ticketFeeSettlement.activeTier.ticketsRemaining.toLocaleString()} tickets until next tier`}</em></div>
                </div>}
                {organization.ticketFeeSettlement?.periodTo && new Date(organization.ticketFeeSettlement.periodTo) <= new Date() && !organization.ticketFeeRemittances.some((remittance) => remittance.agreementId === organization.ticketFeeSettlement?.agreementId && remittance.periodFrom === organization.ticketFeeSettlement?.periodFrom) && <div className="remittance-finalize"><label>Remittance due date<input type="date" value={ticketFeeRemittanceDueDate} onChange={(event) => setTicketFeeRemittanceDueDate(event.target.value)} /></label><div><p>This settlement period is complete and may be locked as an operator remittance receivable.</p><button disabled={saving} onClick={() => void finalizeTicketFeeRemittance()}>Finalize period</button></div></div>}
                {organization.ticketFeeRemittances.length > 0 && <div className="remittance-ledger"><div className="editor-heading"><div><p className="eyebrow">REMITTANCE LEDGER</p><h4>Operator fee remittances</h4></div></div>{organization.ticketFeeRemittances.map((remittance) => <article key={remittance.id}><div><span className={`status-chip ${remittance.status === "PAID" ? "status-success" : remittance.status === "VOID" ? "status-danger" : ""}`}>{remittance.status}</span><strong>{new Date(remittance.periodFrom).toLocaleDateString()} – {new Date(remittance.periodTo).toLocaleDateString()}</strong><small>{remittance.ticketCount.toLocaleString()} tickets · {money(remittance.collectedFeeCents)} customer fees</small><small>Collection owner: {remittance.collectionOwner?.name ?? "Unassigned"}</small>{remittance.notes && <small>Collection note: {remittance.notes}</small>}{remittance.lastContactedAt && <small>Last contacted {new Date(remittance.lastContactedAt).toLocaleDateString()}</small>}{remittance.nextFollowUpAt && <small>Next follow-up {new Date(remittance.nextFollowUpAt).toLocaleDateString()}</small>}</div><div><small>Ringo receivable</small><strong>{money(remittance.platformShareCents)}</strong><em>{remittance.status === "PAID" ? `Paid ${remittance.paidAt ? new Date(remittance.paidAt).toLocaleDateString() : ""}` : remittance.dueDate ? `Due ${new Date(remittance.dueDate).toLocaleDateString()}` : "No due date"}</em>{remittance.paymentReference && <em>Ref: {remittance.paymentReference}</em>}</div>{session.user.role !== "VIEWER" && <div className="remittance-actions"><button className="quiet" disabled={saving} onClick={() => void editTicketFeeRemittanceNotes(remittance.id, remittance.status, remittance.notes)}>{remittance.notes ? "Edit note" : "Add note"}</button>{remittance.status === "DUE" && <><button className="quiet" disabled={saving} onClick={() => void assignTicketFeeRemittanceToMe(remittance.id)}>Assign to me</button><button className="quiet" disabled={saving} onClick={() => void logTicketFeeRemittanceContact(remittance.id, remittance.notes)}>Log contact</button><button disabled={saving} onClick={() => void updateTicketFeeRemittance(remittance.id, "PAID")}>Mark paid</button><button className="danger" disabled={saving} onClick={() => void updateTicketFeeRemittance(remittance.id, "VOID")}>Void</button></>}</div>}</article>)}</div>}
                {organization.ticketFeeAgreements.length > 0 && <div className="agreement-history">
                  {organization.ticketFeeAgreements.map((agreement, index) => <article key={agreement.id}>
                    <div><span className={`status-chip ${index === 0 && !agreement.effectiveTo ? "status-success" : ""}`}>{index === 0 && !agreement.effectiveTo ? "Current version" : "Historical version"}</span><h4>{agreement.name}</h4><p>{new Date(agreement.effectiveFrom).toLocaleDateString()} – {agreement.effectiveTo ? new Date(agreement.effectiveTo).toLocaleDateString() : "present"} · {agreement.tiers.length === 1 ? "flat split" : agreement.thresholdPeriod.toLowerCase().replaceAll("_", " ")}</p></div>
                    <div className="agreement-tiers">{agreement.tiers.map((tier) => <span key={tier.startsAtTicket}><strong>{agreement.tiers.length === 1 ? "Every paid ticket" : `${tier.startsAtTicket.toLocaleString()}–${tier.endsAtTicket?.toLocaleString() ?? "∞"} tickets`}</strong><em>Customer {money(agreement.customerFeeMinor)} · Ringo {money(tier.platformShareMinor)} · Operator {money(tier.operatorShareMinor)}</em></span>)}</div>
                  </article>)}
                </div>}
              </section>
              <section className="dashboard-panel platform-revenue client-financials">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">FINANCIALS</p>
                    <h3>Client revenue</h3>
                    <p className="muted">
                      Ticket face value, Ringo fees, tax, food and beverage,
                      and refunds across this client&apos;s cinemas.
                    </p>
                  </div>
                  <div className="revenue-actions">
                    <div
                      className="range-toggle"
                      aria-label="Client revenue date range"
                    >
                      {revenueRanges.map((range) => (
                        <button
                          type="button"
                          key={range.days}
                          className={
                            revenueRangeKey === range.days ? "active" : "quiet"
                          }
                          disabled={revenueLoading}
                          onClick={() => setRevenueRangeKey(range.days)}
                        >
                          {range.label}
                        </button>
                      ))}
                      <button type="button" className={revenueRangeKey === "custom" ? "active" : "quiet"} disabled={revenueLoading} onClick={() => setRevenueRangeKey("custom")}>Custom</button>
                    </div>
                    <button
                      type="button"
                      className="quiet"
                      disabled={revenueLoading || !revenue || (revenueRangeKey === "custom" && (!customFrom || !customTo || customFrom > customTo))}
                      onClick={() => void downloadClientRevenue()}
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                {revenueRangeKey === "custom" && <div className="custom-range film-custom-range"><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
                {!revenue && <p className="muted">Loading client revenue…</p>}
                {revenue && (
                  <>
                    <div className="revenue-breakdown">
                      <article>
                        <span>Ticket face value</span>
                        <strong>
                          {money(revenue.totals.ticketRevenueCents)}
                        </strong>
                      </article>
                      <article>
                        <span>Ringo fee revenue</span>
                        <strong>{money(revenue.totals.ticketFeesCents)}</strong>
                      </article>
                      <article>
                        <span>Ticket tax</span>
                        <strong>{money(revenue.totals.ticketTaxCents)}</strong>
                      </article>
                      <article>
                        <span>Total collected</span>
                        <strong>
                          {money(revenue.totals.ticketCollectedCents)}
                        </strong>
                      </article>
                      <article>
                        <span>F&amp;B revenue</span>
                        <strong>{money(revenue.totals.fnbRevenueCents)}</strong>
                      </article>
                      <article>
                        <span>Cinema net</span>
                        <strong>
                          {money(revenue.totals.combinedRevenueCents)}
                        </strong>
                      </article>
                      <article>
                        <span>Memberships</span>
                        <strong>{money(revenue.totals.membershipRevenueCents)}</strong>
                        <small>{revenue.totals.membershipPurchases.toLocaleString()} purchases</small>
                      </article>
                      <article>
                        <span>Donations</span>
                        <strong>{money(revenue.totals.donationRevenueCents)}</strong>
                        <small>{revenue.totals.donations.toLocaleString()} contributions</small>
                      </article>
                      <article>
                        <span>All collected</span>
                        <strong>{money(revenue.totals.totalCollectedCents)}</strong>
                      </article>
                      <article>
                        <span>Refunds</span>
                        <strong>{money(revenue.totals.refundedCents)}</strong>
                      </article>
                    </div>
                    <p className="dashboard-updated">
                      {revenue.totals.ticketsSold.toLocaleString()} tickets sold
                      · {revenue.totals.fnbOrders.toLocaleString()} F&amp;B
                      orders · Updated{" "}
                      {new Date(revenue.generatedAt).toLocaleString()}
                    </p>
                  </>
                )}
              </section>
              {organization.locations.map((location) => (
                <article className="location-detail" key={location.id}>
                  <div className="location-detail-heading">
                    <div>
                      <div className="location-title">
                        <h3>{location.name}</h3>
                        <span
                          className={location.active ? "dot active" : "dot"}
                        >
                          {location.active ? "Active" : "Inactive"}
                        </span>
                        {location.brandingDraft && (
                          <span className="status warning">Branding draft</span>
                        )}
                      </div>
                      <p className="muted">
                        {location.address ?? "Address not configured"} ·{" "}
                        {location.timezone}
                      </p>
                    </div>
                    <div className="actions horizontal">
                      <button
                        className="edit-button"
                        onClick={() => beginLocationEdit(location)}
                      >
                        {location.brandingDraft
                          ? "Review cinema draft"
                          : "Edit cinema"}
                      </button>
                      {location.brandingDraft && (
                        <button
                          className="edit-button"
                          disabled={saving}
                          onClick={() => void publishBranding(location)}
                        >
                          Publish branding
                        </button>
                      )}
                      <button
                        className="edit-button"
                        onClick={() =>
                          setContentDraft({
                            id: location.id,
                            values: structuredClone(location.content.draft),
                          })
                        }
                      >
                        Content Studio
                      </button>
                      <button
                        className="edit-button"
                        disabled={saving}
                        onClick={() => void publishContent(location)}
                      >
                        Publish draft
                      </button>
                      <button
                        className="edit-button"
                        onClick={() =>
                          setCinemaManagerDraft({
                            locationId: location.id,
                            name: "",
                            email: "",
                            password: "",
                          })
                        }
                      >
                        Add cinema manager
                      </button>
                      <a
                        href={CINEMA_ADMIN_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open cinema admin ↗
                      </a>
                      {session.user.role !== "VIEWER" && (
                        <button
                          className="quiet"
                          disabled={
                            saving || !organization.active || !location.active
                          }
                          onClick={() => void openSupportSession(location)}
                        >
                          Open read-only support ↗
                        </button>
                      )}
                      <a
                        href={`${CUSTOMER_WEB_URL.replace(/\/$/, "")}/showtimes?locationId=${encodeURIComponent(location.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open customer site ↗
                      </a>
                    </div>
                  </div>
                  <div className="readiness-grid branding-readiness">
                    <section>
                      <p className="eyebrow">READINESS</p>
                      <div className="metric-grid">
                        <span>
                          <b>{location.configuration.auditoriums}</b>{" "}
                          Auditoriums
                        </span>
                        <span>
                          <b>{location.configuration.activeMovies}</b> Active
                          movies
                        </span>
                        <span>
                          <b>{location.configuration.activeFilmSeries}</b> Film
                          series
                        </span>
                        <span>
                          <b>{location.configuration.upcomingShowtimes}</b>{" "}
                          Upcoming shows
                        </span>
                        <span>
                          <b>{location.configuration.menuItems}</b> Menu items
                        </span>
                        <span>
                          <b>{location.configuration.employees}</b> Active staff
                        </span>
                      </div>
                    </section>
                    <section>
                      <p className="eyebrow">CUSTOMER BRAND</p>
                      <div
                        className="brand-preview"
                        style={{
                          background: `radial-gradient(circle at top right, ${location.branding.backgroundGlowColor ?? "#3a0f1b"}, ${location.branding.backgroundColor ?? "#090a0c"} 45%)`,
                          color: location.branding.textColor ?? "#f5f2ea",
                          borderColor:
                            location.branding.accentColor ?? "#7c9cff",
                        }}
                      >
                        <span
                          className="brand-mark"
                          style={{
                            background:
                              location.branding.accentColor ?? "#7c9cff",
                          }}
                        />
                        {location.branding.logoUrl ? (
                          <span>Custom logo configured</span>
                        ) : (
                          <span>Text identity · {location.name}</span>
                        )}
                      </div>
                      <div className="swatches">
                        {[
                          ["Accent", location.branding.accentColor],
                          ["Background", location.branding.backgroundColor],
                          [
                            "Background glow",
                            location.branding.backgroundGlowColor,
                          ],
                          ["Surface", location.branding.surfaceColor],
                          ["Text", location.branding.textColor],
                        ].map(([label, color]) => (
                          <span key={label}>
                            <i style={{ background: color ?? "transparent" }} />
                            {label}
                            <code>{color ?? "Default"}</code>
                          </span>
                        ))}
                      </div>
                    </section>
                    <section>
                      <p className="eyebrow">ADMIN INTERFACE</p>
                      <div
                        className="brand-preview admin-preview"
                        style={{
                          background:
                            location.adminBranding.backgroundColor ?? "#000000",
                          color: location.adminBranding.textColor ?? "#ffffff",
                          borderColor:
                            location.adminBranding.accentMutedColor ??
                            "#8a6500",
                        }}
                      >
                        <span
                          className="brand-mark"
                          style={{
                            background:
                              location.adminBranding.accentColor ?? "#ffb800",
                          }}
                        />
                        <span>Ringo Admin · {location.name}</span>
                      </div>
                      <div className="swatches">
                        {[
                          ["Accent", location.adminBranding.accentColor],
                          [
                            "Background",
                            location.adminBranding.backgroundColor,
                          ],
                          ["Surface", location.adminBranding.surfaceColor],
                          ["Text", location.adminBranding.textColor],
                        ].map(([label, color]) => (
                          <span key={label}>
                            <i style={{ background: color ?? "transparent" }} />
                            {label}
                            <code>{color ?? "Default"}</code>
                          </span>
                        ))}
                      </div>
                    </section>
                    <section>
                      <p className="eyebrow">OPERATING SETTINGS</p>
                      <dl>
                        <div>
                          <dt>Ticket tax</dt>
                          <dd>
                            {(
                              location.operations.ticketTaxRateBasisPoints / 100
                            ).toFixed(2)}
                            %
                          </dd>
                        </div>
                        <div>
                          <dt>Pre-show buffer</dt>
                          <dd>
                            {location.operations.preShowBufferMinutes} min
                          </dd>
                        </div>
                        <div>
                          <dt>Cleaning buffer</dt>
                          <dd>
                            {location.operations.cleaningBufferMinutes} min
                          </dd>
                        </div>
                        <div>
                          <dt>Check drop</dt>
                          <dd>
                            {location.operations.checkDropMinutesBeforeEnd} min
                            before end
                          </dd>
                        </div>
                        <div>
                          <dt>Auto-settle grace</dt>
                          <dd>
                            {location.operations.autoSettleGraceMinutes} min
                          </dd>
                        </div>
                        <div>
                          <dt>Time clock</dt>
                          <dd>
                            {location.operations.timeClockEnabled
                              ? "Enabled"
                              : "Disabled"}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                  <section className="auditorium-overview">
                    <div className="auditorium-overview-heading">
                      <div>
                        <p className="eyebrow">VENUE LAYOUTS</p>
                        <h3>Auditoriums &amp; seat maps</h3>
                      </div>
                      <div className="auditorium-overview-actions">
                        <p className="muted">
                          Authoritative cinema layouts, scoped to{" "}
                          {location.name}.
                        </p>
                        {session.user.role !== "VIEWER" &&
                          auditoriumDraft?.locationId !== location.id && (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() =>
                                setAuditoriumDraft({
                                  locationId: location.id,
                                  name: `Theater ${location.auditoriums.length + 1}`,
                                  seatingMode: organization.defaultSeatingMode,
                                  seatingStyle: "SINGLE",
                                  capacity: 96,
                                  rows: 8,
                                  seatsPerRow: 12,
                                  centerAisle: true,
                                  accessiblePairs: 1,
                                })
                              }
                            >
                              + Add auditorium
                            </button>
                          )}
                      </div>
                    </div>
                    {auditoriumDraft?.locationId === location.id && (
                      <form
                        className="master-auditorium-builder"
                        data-onboarding-section="auditorium"
                        onSubmit={saveAuditorium}
                      >
                        <div className="editor-heading">
                          <div>
                            <p className="eyebrow">LAYOUT DESIGNER</p>
                            <h3>
                              {auditoriumDraft.id
                                ? "Edit auditorium"
                                : "Create an auditorium"}
                            </h3>
                            <p className="muted">
                              Build a standard room quickly. Existing
                              cinema-admin layout controls remain available for
                              advanced edits.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => setAuditoriumDraft(null)}
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="auditorium-builder-fields">
                          <label>
                            Theater name
                            <input
                              required
                              maxLength={80}
                              value={auditoriumDraft.name}
                              onChange={(event) =>
                                setAuditoriumDraft({
                                  ...auditoriumDraft,
                                  name: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Seating type
                            <select
                              value={auditoriumDraft.seatingMode}
                              onChange={(event) =>
                                setAuditoriumDraft({
                                  ...auditoriumDraft,
                                  seatingMode: event.target
                                    .value as AuditoriumDraft["seatingMode"],
                                })
                              }
                            >
                              <option value="RESERVED">Reserved seats</option>
                              <option value="GENERAL_ADMISSION">
                                General admission
                              </option>
                            </select>
                          </label>
                          {auditoriumDraft.seatingMode ===
                          "GENERAL_ADMISSION" ? (
                            <label>
                              Sellable capacity
                              <input
                                type="number"
                                min={1}
                                max={500}
                                required
                                value={auditoriumDraft.capacity}
                                onChange={(event) =>
                                  setAuditoriumDraft({
                                    ...auditoriumDraft,
                                    capacity: Math.max(
                                      1,
                                      Math.min(500, Number(event.target.value)),
                                    ),
                                  })
                                }
                              />
                            </label>
                          ) : (
                            <>
                              <label>
                                Rows
                                <input
                                  type="number"
                                  min={8}
                                  max={20}
                                  value={auditoriumDraft.rows}
                                  onChange={(event) =>
                                    setAuditoriumDraft({
                                      ...auditoriumDraft,
                                      rows: Math.max(
                                        8,
                                        Math.min(
                                          20,
                                          Number(event.target.value),
                                        ),
                                      ),
                                      sourceSeats: undefined,
                                      sourceLayout: undefined,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Seats per row
                                <input
                                  type="number"
                                  min={auditoriumDraft.centerAisle ? 11 : 12}
                                  max={25}
                                  value={auditoriumDraft.seatsPerRow}
                                  onChange={(event) => {
                                    const seatsPerRow = Math.max(
                                      auditoriumDraft.centerAisle ? 11 : 12,
                                      Math.min(25, Number(event.target.value)),
                                    );
                                    setAuditoriumDraft({
                                      ...auditoriumDraft,
                                      seatsPerRow,
                                      accessiblePairs: Math.min(
                                        auditoriumDraft.accessiblePairs,
                                        Math.floor(seatsPerRow / 2),
                                      ),
                                      sourceSeats: undefined,
                                      sourceLayout: undefined,
                                    });
                                  }}
                                />
                              </label>
                              <label>
                                Seating style
                                <select
                                  value={auditoriumDraft.seatingStyle}
                                  onChange={(event) =>
                                    setAuditoriumDraft({
                                      ...auditoriumDraft,
                                      seatingStyle: event.target.value as SeatMapLayout["seatingStyle"],
                                    })
                                  }
                                >
                                  <option value="SINGLE">Single</option>
                                  <option value="PAIR">Pairs</option>
                                  <option value="LOVESEAT">Love seat</option>
                                  <option value="TABLE_2">Table · 2</option>
                                  <option value="TABLE_4">Table · 4</option>
                                  <option value="BENCH">Bench / sofa</option>
                                </select>
                              </label>
                              <label>
                                Accessible pairs
                                <input
                                  type="number"
                                  min={0}
                                  max={Math.floor(
                                    auditoriumDraft.seatsPerRow / 2,
                                  )}
                                  value={auditoriumDraft.accessiblePairs}
                                  onChange={(event) =>
                                    setAuditoriumDraft({
                                      ...auditoriumDraft,
                                      accessiblePairs: Math.max(
                                        0,
                                        Math.min(
                                          Math.floor(
                                            auditoriumDraft.seatsPerRow / 2,
                                          ),
                                          Number(event.target.value),
                                        ),
                                      ),
                                      sourceSeats: undefined,
                                      sourceLayout: undefined,
                                    })
                                  }
                                />
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={auditoriumDraft.centerAisle}
                                  onChange={(event) =>
                                    setAuditoriumDraft({
                                      ...auditoriumDraft,
                                      centerAisle: event.target.checked,
                                      seatsPerRow: Math.max(
                                        event.target.checked ? 11 : 12,
                                        auditoriumDraft.seatsPerRow,
                                      ),
                                      sourceSeats: undefined,
                                      sourceLayout: undefined,
                                    })
                                  }
                                />{" "}
                                Center aisle
                              </label>
                            </>
                          )}
                        </div>
                        {auditoriumDraft.seatingMode === "RESERVED" ? (
                          <>
                            <div
                              className="master-seat-preview master-builder-preview"
                              role="img"
                              aria-label={`${auditoriumDraft.name} seat map preview`}
                              style={{
                                gridTemplateColumns: `repeat(${auditoriumLayout(auditoriumDraft).canvas.width}, minmax(12px, 1fr))`,
                                gridTemplateRows: `repeat(${auditoriumDraft.rows}, 20px)`,
                              }}
                            >
                              {auditoriumSeats(auditoriumDraft).map((seat) => (
                                <i
                                  key={seat.label}
                                  className={seat.type.toLowerCase()}
                                  style={{
                                    gridColumn: seat.x + 1,
                                    gridRow: seat.y + 1,
                                  }}
                                  title={`${seat.label} · ${seat.type.toLowerCase()}`}
                                />
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="form-note">
                            General-admission customers choose a quantity rather
                            than individual seats. This capacity is enforced
                            separately for each showtime.
                          </p>
                        )}
                        <div className="master-builder-summary">
                          <span>
                            <b>
                              {auditoriumDraft.seatingMode ===
                              "GENERAL_ADMISSION"
                                ? auditoriumDraft.capacity
                                : auditoriumSeats(auditoriumDraft).length}
                            </b>{" "}
                            admission positions
                          </span>
                          {auditoriumDraft.seatingMode === "RESERVED" && (
                            <span>
                              <b>{auditoriumDraft.accessiblePairs}</b>{" "}
                              accessible pairs
                            </span>
                          )}
                          <button disabled={saving}>
                            {saving
                              ? "Saving…"
                              : auditoriumDraft.id
                                ? "Save auditorium"
                                : "Create auditorium"}
                          </button>
                        </div>
                        <p className="form-note">
                          Ringo models the layout supplied by the operator. It
                          does not certify ADA, fire, egress, or building-code
                          compliance.
                        </p>
                      </form>
                    )}
                    <div className="auditorium-overview-grid">
                      {location.auditoriums.map((auditorium) => (
                        <article key={auditorium.id}>
                          <div className="auditorium-card-heading">
                            <strong>{auditorium.name}</strong>
                            <span
                              className={`status ${auditorium.active ? "good" : ""}`}
                            >
                              {auditorium.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          {session.user.role !== "VIEWER" && (
                            <div className="auditorium-overview-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  const activeSeats =
                                    auditorium.seatMap?.seats.filter(
                                      (seat) => seat.active,
                                    ) ?? [];
                                  const rows = Math.max(
                                    1,
                                    ...activeSeats.map((seat) => seat.y + 1),
                                  );
                                  const seatsPerRow = Math.max(
                                    2,
                                    Math.ceil(activeSeats.length / rows),
                                  );
                                  setAuditoriumDraft({
                                    id: auditorium.id,
                                    locationId: location.id,
                                    name: auditorium.name,
                                    seatingMode:
                                      auditorium.seatingMode ?? "RESERVED",
                                    seatingStyle:
                                      auditorium.seatMap?.layout?.seatingStyle ??
                                      "SINGLE",
                                    capacity: auditorium.capacity,
                                    rows,
                                    seatsPerRow,
                                    centerAisle: false,
                                    accessiblePairs:
                                      auditorium.seatMap?.accessibleSeats ?? 0,
                                    sourceLayout:
                                      auditorium.seatMap?.layout ?? undefined,
                                    sourceSeats: activeSeats.map(
                                      ({ id: _id, active: _active, ...seat }) =>
                                        seat,
                                    ),
                                  });
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  void deleteAuditorium(
                                    location.id,
                                    auditorium.id,
                                    auditorium.name,
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          )}
                          <dl>
                            <div>
                              <dt>Seating type</dt>
                              <dd>
                                {auditorium.seatingMode === "GENERAL_ADMISSION"
                                  ? "General admission"
                                  : "Reserved seats"}
                              </dd>
                            </div>
                            <div>
                              <dt>Configured capacity</dt>
                              <dd>{auditorium.capacity}</dd>
                            </div>
                            <div>
                              <dt>Seat map</dt>
                              <dd>
                                {auditorium.seatMap?.name ?? "Not configured"}
                              </dd>
                            </div>
                            {auditorium.seatMap && (
                              <>
                                <div>
                                  <dt>Active seats</dt>
                                  <dd>{auditorium.seatMap.activeSeats}</dd>
                                </div>
                                <div>
                                  <dt>Accessible / companion</dt>
                                  <dd>
                                    {auditorium.seatMap.accessibleSeats} /{" "}
                                    {auditorium.seatMap.companionSeats}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Layout version</dt>
                                  <dd>v{auditorium.seatMap.version}</dd>
                                </div>
                                <div
                                  className="master-seat-preview"
                                  role="img"
                                  aria-label={`${auditorium.name} read-only seat map`}
                                  style={{
                                    gridTemplateColumns: `repeat(${Math.max(1, ...auditorium.seatMap.seats.map((seat) => seat.x + 1))}, minmax(12px, 1fr))`,
                                    gridTemplateRows: `repeat(${Math.max(1, ...auditorium.seatMap.seats.map((seat) => seat.y + 1))}, 18px)`,
                                  }}
                                >
                                  {auditorium.seatMap.seats.map((seat) => (
                                    <i
                                      key={seat.id}
                                      className={`${seat.active ? "" : "inactive"} ${seat.type.toLowerCase()}`}
                                      style={{
                                        gridColumn: seat.x + 1,
                                        gridRow: seat.y + 1,
                                      }}
                                      title={`${seat.label} · ${seat.type.toLowerCase()}${seat.active ? "" : " · inactive"}`}
                                    />
                                  ))}
                                </div>
                              </>
                            )}
                          </dl>
                          {session.user.role !== "VIEWER" && (
                            <div className="auditorium-card-actions">
                              <button
                                type="button"
                                className="quiet"
                                disabled={saving}
                                onClick={() =>
                                  duplicateAuditorium(location, auditorium)
                                }
                              >
                                Duplicate
                              </button>
                              {auditorium.active ? (
                                <button
                                  type="button"
                                  className="danger"
                                  disabled={saving}
                                  onClick={() =>
                                    deactivateAuditorium(location, auditorium)
                                  }
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="danger"
                                  disabled={saving}
                                  onClick={() =>
                                    deleteAuditorium(
                                      location.id,
                                      auditorium.id,
                                      auditorium.name,
                                    )
                                  }
                                >
                                  Delete permanently
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                      {location.auditoriums.length === 0 && (
                        <p className="muted">
                          No auditoriums have been configured for this cinema.
                        </p>
                      )}
                    </div>
                  </section>
                  {cinemaManagerDraft?.locationId === location.id && (
                    <form
                      className="editor location-editor"
                      data-onboarding-section="staff"
                      onSubmit={createCinemaManager}
                    >
                      <div className="editor-heading">
                        <div>
                          <p className="eyebrow">CINEMA ACCESS</p>
                          <h3>Create {location.name} manager login</h3>
                          <p className="muted">
                            This account is isolated to this cinema. Cinema
                            Manager access does not require two-step
                            verification.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setCinemaManagerDraft(null)}
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="form-grid">
                        <label>
                          Name
                          <input
                            required
                            value={cinemaManagerDraft.name}
                            onChange={(event) =>
                              setCinemaManagerDraft({
                                ...cinemaManagerDraft,
                                name: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Email
                          <input
                            type="email"
                            required
                            value={cinemaManagerDraft.email}
                            onChange={(event) =>
                              setCinemaManagerDraft({
                                ...cinemaManagerDraft,
                                email: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Initial password
                          <input
                            type="password"
                            minLength={12}
                            required
                            value={cinemaManagerDraft.password}
                            onChange={(event) =>
                              setCinemaManagerDraft({
                                ...cinemaManagerDraft,
                                password: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="form-note">
                        Use at least 12 characters. The password is sent once
                        over the secure API and is stored only as a one-way
                        hash.
                      </p>
                      <button disabled={saving}>
                        {saving ? "Creating…" : "Create cinema manager"}
                      </button>
                    </form>
                  )}
                  {locationDraft?.id === location.id && (
                    <form
                      className="editor location-editor"
                      data-onboarding-section="branding"
                      onSubmit={saveLocation}
                    >
                      <div className="editor-heading">
                        <div>
                          <p className="eyebrow">PLATFORM CONFIGURATION</p>
                          <h3>Edit {location.name}</h3>
                          <p className="muted">
                            Preview both cinema surfaces here. Operating
                            settings save immediately; branding stays private as
                            a draft until you publish it.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setLocationDraft(null)}
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="form-grid">
                        <label>
                          Cinema name
                          <input
                            required
                            value={locationDraft.values.name}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  name: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Address
                          <input
                            value={locationDraft.values.address}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  address: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Timezone
                          <input
                            required
                            value={locationDraft.values.timezone}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  timezone: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={locationDraft.values.active}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  active: event.target.checked,
                                },
                              })
                            }
                          />{" "}
                          Active cinema
                        </label>
                      </div>
                      <h4>Customer website</h4>
                      <div className="form-grid brand-fields">
                        <label>
                          Logo URL
                          <input
                            value={locationDraft.values.logoUrl}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  logoUrl: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        {(
                          [
                            "accentColor",
                            "accentMutedColor",
                            "backgroundColor",
                            "backgroundGlowColor",
                            "surfaceColor",
                            "textColor",
                            "mutedTextColor",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            {key.replace(/([A-Z])/g, " $1")}
                            <div className="color-input">
                              <input
                                type="color"
                                value={locationDraft.values[key] || "#000000"}
                                onChange={(event) =>
                                  setLocationDraft({
                                    ...locationDraft,
                                    values: {
                                      ...locationDraft.values,
                                      [key]: event.target.value,
                                    },
                                  })
                                }
                              />
                              <input
                                placeholder="#fe2c54"
                                value={locationDraft.values[key]}
                                onChange={(event) =>
                                  setLocationDraft({
                                    ...locationDraft,
                                    values: {
                                      ...locationDraft.values,
                                      [key]: event.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                          </label>
                        ))}
                      </div>
                      <div
                        className="live-brand-preview"
                        style={{
                          background: `radial-gradient(circle at top right, ${locationDraft.values.backgroundGlowColor || "#3a0f1b"}, ${locationDraft.values.backgroundColor || "#0b0b0d"} 45%)`,
                          color: locationDraft.values.textColor || "#f5f3ee",
                          borderColor:
                            locationDraft.values.accentMutedColor || "#a91d39",
                        }}
                      >
                        <span
                          style={{
                            color:
                              locationDraft.values.accentColor || "#fe2c54",
                          }}
                        >
                          NOW PLAYING
                        </span>
                        <strong>{locationDraft.values.name}</strong>
                        <small
                          style={{
                            color:
                              locationDraft.values.mutedTextColor || "#a8a49c",
                          }}
                        >
                          Customer website preview
                        </small>
                      </div>
                      <div className="editor-heading">
                        <h4>Cinema admin interface</h4>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            setLocationDraft({
                              ...locationDraft,
                              values: {
                                ...locationDraft.values,
                                ...RECOMMENDED_ADMIN_PALETTE,
                              },
                            })
                          }
                        >
                          Use recommended palette
                        </button>
                      </div>
                      <div className="form-grid brand-fields">
                        {(
                          [
                            "adminAccentColor",
                            "adminAccentMutedColor",
                            "adminBackgroundColor",
                            "adminSurfaceColor",
                            "adminTextColor",
                            "adminMutedTextColor",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            {key
                              .replace(/^admin/, "")
                              .replace(/([A-Z])/g, " $1")
                              .trim()}
                            <div className="color-input">
                              <input
                                type="color"
                                value={locationDraft.values[key] || "#000000"}
                                onChange={(event) =>
                                  setLocationDraft({
                                    ...locationDraft,
                                    values: {
                                      ...locationDraft.values,
                                      [key]: event.target.value,
                                    },
                                  })
                                }
                              />
                              <input
                                placeholder="#ffb800"
                                value={locationDraft.values[key]}
                                onChange={(event) =>
                                  setLocationDraft({
                                    ...locationDraft,
                                    values: {
                                      ...locationDraft.values,
                                      [key]: event.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                          </label>
                        ))}
                      </div>
                      <div
                        className="live-brand-preview admin-live-preview"
                        style={{
                          background:
                            locationDraft.values.adminBackgroundColor ||
                            "#000000",
                          color:
                            locationDraft.values.adminTextColor || "#ffffff",
                          borderColor:
                            locationDraft.values.adminAccentMutedColor ||
                            "#8a6500",
                        }}
                      >
                        <span
                          style={{
                            color:
                              locationDraft.values.adminAccentColor ||
                              "#ffb800",
                          }}
                        >
                          RINGO ADMIN
                        </span>
                        <strong>{locationDraft.values.name}</strong>
                        <small
                          style={{
                            color:
                              locationDraft.values.adminMutedTextColor ||
                              "#cccccc",
                          }}
                        >
                          Cinema staff interface preview
                        </small>
                      </div>
                      <AdminUiEditor
                        value={locationDraft.values.adminUi}
                        onChange={(adminUi) =>
                          setLocationDraft({
                            ...locationDraft,
                            values: { ...locationDraft.values, adminUi },
                          })
                        }
                        onRestore={(palette) =>
                          setLocationDraft({
                            ...locationDraft,
                            values: {
                              ...locationDraft.values,
                              adminAccentColor: palette.accentColor,
                              adminAccentMutedColor: palette.accentMutedColor,
                              adminBackgroundColor: palette.backgroundColor,
                              adminSurfaceColor: palette.surfaceColor,
                              adminTextColor: palette.textColor,
                              adminMutedTextColor: palette.mutedTextColor,
                              adminUi: {
                                ...locationDraft.values.adminUi,
                                onSaleColor: palette.onSaleColor,
                                draftColor: palette.draftColor,
                                pastColor: palette.pastColor,
                              },
                            },
                          })
                        }
                      />
                      <h4>Operating settings</h4>
                      <div className="form-grid">
                        {(
                          [
                            "ticketTaxRateBasisPoints",
                            "preShowBufferMinutes",
                            "cleaningBufferMinutes",
                            "checkDropMinutesBeforeEnd",
                            "autoSettleGraceMinutes",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            {key.replace(/([A-Z])/g, " $1")}
                            <input
                              type="number"
                              min="0"
                              value={locationDraft.values[key]}
                              onChange={(event) =>
                                setLocationDraft({
                                  ...locationDraft,
                                  values: {
                                    ...locationDraft.values,
                                    [key]: Number(event.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={locationDraft.values.timeClockEnabled}
                            onChange={(event) =>
                              setLocationDraft({
                                ...locationDraft,
                                values: {
                                  ...locationDraft.values,
                                  timeClockEnabled: event.target.checked,
                                },
                              })
                            }
                          />{" "}
                          Time clock enabled
                        </label>
                      </div>
                      <button disabled={saving}>
                        {saving
                          ? "Saving…"
                          : "Save settings and branding draft"}
                      </button>
                    </form>
                  )}
                  {contentDraft?.id === location.id && (
                    <form
                      className="editor location-editor"
                      onSubmit={saveContentDraft}
                    >
                      <div className="editor-heading">
                        <div>
                          <p className="eyebrow">CONTENT STUDIO</p>
                          <h3>Edit customer website draft</h3>
                          <p className="muted">
                            Changes stay private until you publish. Page
                            structure and accessibility remain protected.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setContentDraft(null)}
                        >
                          Cancel
                        </button>
                      </div>
                      <h4>Typography</h4>
                      <div className="form-grid">
                        <label>
                          Heading style
                          <select
                            value={contentDraft.values.typography.headingFont}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  typography: {
                                    ...contentDraft.values.typography,
                                    headingFont: event.target
                                      .value as CinemaContent["typography"]["headingFont"],
                                  },
                                },
                              })
                            }
                          >
                            <option value="EDITORIAL">Editorial serif</option>
                            <option value="CLASSIC">Classic serif</option>
                            <option value="MODERN">Modern sans</option>
                          </select>
                        </label>
                        <label>
                          Body style
                          <select
                            value={contentDraft.values.typography.bodyFont}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  typography: {
                                    ...contentDraft.values.typography,
                                    bodyFont: event.target
                                      .value as CinemaContent["typography"]["bodyFont"],
                                  },
                                },
                              })
                            }
                          >
                            <option value="SANS">Clean sans</option>
                            <option value="HUMANIST">Humanist sans</option>
                            <option value="SERIF">Serif</option>
                          </select>
                        </label>
                        <label>
                          Heading size
                          <select
                            value={contentDraft.values.typography.headingSize}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  typography: {
                                    ...contentDraft.values.typography,
                                    headingSize: event.target
                                      .value as CinemaContent["typography"]["headingSize"],
                                  },
                                },
                              })
                            }
                          >
                            <option value="COMPACT">Compact</option>
                            <option value="STANDARD">Standard</option>
                            <option value="LARGE">Large</option>
                          </select>
                        </label>
                        <label>
                          Body size
                          <select
                            value={contentDraft.values.typography.bodySize}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  typography: {
                                    ...contentDraft.values.typography,
                                    bodySize: event.target
                                      .value as CinemaContent["typography"]["bodySize"],
                                  },
                                },
                              })
                            }
                          >
                            <option value="COMPACT">Compact</option>
                            <option value="STANDARD">Standard</option>
                            <option value="LARGE">Large</option>
                          </select>
                        </label>
                      </div>
                      <p className="form-note">
                        Font families and sizes apply consistently across every
                        customer page, including Showtimes and Coming Soon.
                      </p>
                      <h4>Navigation</h4>
                      <div className="form-grid">
                        <label>
                          Merchandise shop URL
                          <input
                            type="url"
                            placeholder="https://shop.example.com"
                            value={
                              contentDraft.values.navigation.merchUrl ?? ""
                            }
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  navigation: {
                                    ...contentDraft.values.navigation,
                                    merchUrl: event.target.value.trim() || null,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="form-note">
                        When set, Merch appears in customer navigation and opens
                        the hosted shop in a new tab.
                      </p>
                      <h4>Showtimes page</h4>
                      <div className="form-grid">
                        <label>
                          Eyebrow
                          <input
                            value={contentDraft.values.showtimes.eyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  showtimes: {
                                    ...contentDraft.values.showtimes,
                                    eyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.showtimes.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  showtimes: {
                                    ...contentDraft.values.showtimes,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.showtimes.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  showtimes: {
                                    ...contentDraft.values.showtimes,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          No showtimes message
                          <input
                            value={contentDraft.values.showtimes.empty}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  showtimes: {
                                    ...contentDraft.values.showtimes,
                                    empty: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          No showtimes on date
                          <input
                            value={contentDraft.values.showtimes.emptyDate}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  showtimes: {
                                    ...contentDraft.values.showtimes,
                                    emptyDate: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Coming Soon page</h4>
                      <div className="form-grid">
                        <label>
                          Eyebrow
                          <input
                            value={contentDraft.values.comingSoon.eyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  comingSoon: {
                                    ...contentDraft.values.comingSoon,
                                    eyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.comingSoon.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  comingSoon: {
                                    ...contentDraft.values.comingSoon,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.comingSoon.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  comingSoon: {
                                    ...contentDraft.values.comingSoon,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Empty message
                          <input
                            value={contentDraft.values.comingSoon.empty}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  comingSoon: {
                                    ...contentDraft.values.comingSoon,
                                    empty: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Film Series page</h4>
                      <div className="form-grid">
                        <label>
                          Eyebrow
                          <input
                            value={contentDraft.values.filmSeries.eyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  filmSeries: {
                                    ...contentDraft.values.filmSeries,
                                    eyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.filmSeries.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  filmSeries: {
                                    ...contentDraft.values.filmSeries,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.filmSeries.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  filmSeries: {
                                    ...contentDraft.values.filmSeries,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Empty message
                          <input
                            value={contentDraft.values.filmSeries.empty}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  filmSeries: {
                                    ...contentDraft.values.filmSeries,
                                    empty: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="form-note">
                        Use <code>{"{cinema}"}</code> in the introduction to
                        insert the cinema name.
                      </p>
                      <h4>Directions page</h4>
                      <div className="form-grid">
                        <label>
                          Eyebrow
                          <input
                            value={contentDraft.values.directions.eyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  directions: {
                                    ...contentDraft.values.directions,
                                    eyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.directions.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  directions: {
                                    ...contentDraft.values.directions,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.directions.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  directions: {
                                    ...contentDraft.values.directions,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Directions button
                          <input
                            value={
                              contentDraft.values.directions.directionsLabel
                            }
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  directions: {
                                    ...contentDraft.values.directions,
                                    directionsLabel: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Missing address message
                          <input
                            value={
                              contentDraft.values.directions.addressMissing
                            }
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  directions: {
                                    ...contentDraft.values.directions,
                                    addressMissing: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Account page</h4>
                      <div className="form-grid">
                        <label>
                          Eyebrow
                          <input
                            value={contentDraft.values.account.eyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  account: {
                                    ...contentDraft.values.account,
                                    eyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.account.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  account: {
                                    ...contentDraft.values.account,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.account.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  account: {
                                    ...contentDraft.values.account,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Signed-in label
                          <input
                            value={contentDraft.values.account.signedInEyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  account: {
                                    ...contentDraft.values.account,
                                    signedInEyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          During-visit label
                          <input
                            value={contentDraft.values.account.visitEyebrow}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  account: {
                                    ...contentDraft.values.account,
                                    visitEyebrow: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>About page</h4>
                      <div className="form-grid">
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.about.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  about: {
                                    ...contentDraft.values.about,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.about.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  about: {
                                    ...contentDraft.values.about,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Experience heading
                          <input
                            value={contentDraft.values.about.experienceTitle}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  about: {
                                    ...contentDraft.values.about,
                                    experienceTitle: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Experience copy
                          <textarea
                            value={contentDraft.values.about.body.join("\n\n")}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  about: {
                                    ...contentDraft.values.about,
                                    body: event.target.value
                                      .split(/\n\s*\n/)
                                      .filter(Boolean),
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Afterglow page</h4>
                      <div className="form-grid">
                        <label>
                          Hero image URL
                          <input
                            value={contentDraft.values.afterglow.imageUrl}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  afterglow: {
                                    ...contentDraft.values.afterglow,
                                    imageUrl: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Image description
                          <input
                            value={contentDraft.values.afterglow.imageAlt}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  afterglow: {
                                    ...contentDraft.values.afterglow,
                                    imageAlt: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Heading
                          <input
                            value={contentDraft.values.afterglow.sectionTitle}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  afterglow: {
                                    ...contentDraft.values.afterglow,
                                    sectionTitle: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Copy
                          <textarea
                            value={contentDraft.values.afterglow.body.join(
                              "\n\n",
                            )}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  afterglow: {
                                    ...contentDraft.values.afterglow,
                                    body: event.target.value
                                      .split(/\n\s*\n/)
                                      .filter(Boolean),
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Dining &amp; Bar</h4>
                      <div className="form-grid">
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.dining.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  dining: {
                                    ...contentDraft.values.dining,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.dining.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  dining: {
                                    ...contentDraft.values.dining,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <h4>Private Events</h4>
                      <div className="form-grid">
                        <label>
                          Page title
                          <input
                            value={contentDraft.values.privateEvents.title}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  privateEvents: {
                                    ...contentDraft.values.privateEvents,
                                    title: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Introduction
                          <input
                            value={contentDraft.values.privateEvents.intro}
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  privateEvents: {
                                    ...contentDraft.values.privateEvents,
                                    intro: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Closing heading
                          <input
                            value={
                              contentDraft.values.privateEvents.closingTitle
                            }
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  privateEvents: {
                                    ...contentDraft.values.privateEvents,
                                    closingTitle: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Closing copy
                          <textarea
                            value={
                              contentDraft.values.privateEvents.closingBody
                            }
                            onChange={(event) =>
                              setContentDraft({
                                ...contentDraft,
                                values: {
                                  ...contentDraft.values,
                                  privateEvents: {
                                    ...contentDraft.values.privateEvents,
                                    closingBody: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div
                        className="live-brand-preview"
                        style={{
                          fontFamily:
                            contentDraft.values.typography.headingFont ===
                            "MODERN"
                              ? "Arial, sans-serif"
                              : "Georgia, serif",
                        }}
                      >
                        <span>LIVE DRAFT PREVIEW</span>
                        <strong>{contentDraft.values.about.title}</strong>
                        <small>{contentDraft.values.about.intro}</small>
                      </div>
                      <button disabled={saving}>
                        {saving ? "Saving…" : "Save private draft"}
                      </button>
                      <p className="form-note">
                        Last published:{" "}
                        {location.content.publishedAt
                          ? new Date(
                              location.content.publishedAt,
                            ).toLocaleString()
                          : "Using built-in defaults"}
                        . Use “Publish draft” after reviewing.
                      </p>
                    </form>
                  )}
                  <footer className="detail-note">
                    Ringo Master changes are audited. Cinema staff retain their
                    existing permissions and admin access.
                  </footer>
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {!selectedOrganizationId && (
        <>
          <section className="summary">
            <div>
              <strong>{overview?.organizations.length ?? "—"}</strong>
              <span>Organizations</span>
            </div>
            <div>
              <strong>{locations.length || "—"}</strong>
              <span>Locations</span>
            </div>
            <div>
              <strong>
                {locations.filter((location) => location.active).length || "—"}
              </strong>
              <span>Active locations</span>
            </div>
            <div>
              <strong>
                {locations.reduce(
                  (sum, location) =>
                    sum + location.configuration.upcomingShowtimes,
                  0,
                ) || "—"}
              </strong>
              <span>Upcoming showtimes</span>
            </div>
          </section>
          <section
            className="client-filters"
            aria-label="Filter cinema clients"
          >
            <label>
              Search
              <input
                type="search"
                placeholder="Client, cinema, address, or timezone"
                value={clientQuery}
                onChange={(event) => setClientQuery(event.target.value)}
              />
            </label>
            <label>
              Stripe onboarding
              <select
                value={paymentFilter}
                onChange={(event) => setPaymentFilter(event.target.value)}
              >
                <option value="ALL">All statuses</option>
                <option value="COMPLETE">Complete</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="NOT_STARTED">Not started</option>
                <option value="INCOMPLETE">Any incomplete</option>
              </select>
            </label>
            <label>
              Location status
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
              >
                <option value="ALL">Active or inactive</option>
                <option value="ACTIVE">Has an active location</option>
                <option value="INACTIVE">Has an inactive location</option>
              </select>
            </label>
            <label>
              Location count
              <select
                value={locationCountFilter}
                onChange={(event) => setLocationCountFilter(event.target.value)}
              >
                <option value="ALL">Any number</option>
                <option value="ONE">One location</option>
                <option value="MULTIPLE">Multiple locations</option>
              </select>
            </label>
            <div className="filter-result">
              <strong>{filteredOrganizations.length}</strong>
              <span>of {overview?.organizations.length ?? 0} clients</span>
            </div>
            <button
              className="quiet"
              type="button"
              disabled={!overview || filteredOrganizations.length === 0}
              onClick={exportClientDirectory}
            >
              Export CSV
            </button>
          </section>
          <section className="organizations">
            {!overview && !error && (
              <p className="muted">Loading cinema clients…</p>
            )}
            {overview && filteredOrganizations.length === 0 && (
              <div className="client-empty-state">
                <h2>No clients match</h2>
                <p className="muted">
                  Try a broader search or clear one of the filters.
                </p>
                <button
                  className="quiet"
                  onClick={() => {
                    setClientQuery("");
                    setPaymentFilter("ALL");
                    setLocationFilter("ALL");
                    setLocationCountFilter("ALL");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            {filteredOrganizations.map((organizationItem) => (
              <article className="organization" key={organizationItem.id}>
                <div className="org-heading">
                  <div>
                    <p className="eyebrow">ORGANIZATION</p>
                    <h2>{organizationItem.name}</h2>
                    <p className="muted">
                      {organizationItem.businessTypeLabel ?? "Unclassified"} ·{" "}
                      {organizationItem.legalName ?? organizationItem.timezone}
                    </p>
                  </div>
                  <div className="org-actions">
                    <span
                      className={
                        organizationItem.payments.connected
                          ? "status good"
                          : "status warning"
                      }
                    >
                      {organizationItem.payments.connected
                        ? `Payments ${organizationItem.payments.onboardingStatus.toLowerCase()}`
                        : "Payments not connected"}
                    </span>
                    <button
                      className="open-client"
                      onClick={() =>
                        setSelectedOrganizationId(organizationItem.id)
                      }
                    >
                      Open cinema →
                    </button>
                  </div>
                </div>
                <div className="location-list">
                  {organizationItem.locations.map((location) => (
                    <div className="location" key={location.id}>
                      <div>
                        <div className="location-title">
                          <h3>{location.name}</h3>
                          <span
                            className={location.active ? "dot active" : "dot"}
                          >
                            {location.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="muted">
                          {location.address ?? location.timezone}
                        </p>
                        <code>{location.id}</code>
                      </div>
                      <div className="signals">
                        <span>
                          <b>{location.configuration.auditoriums}</b>{" "}
                          auditoriums
                        </span>
                        <span>
                          <b>{location.configuration.employees}</b> staff
                        </span>
                        <span>
                          <b>{location.configuration.menuItems}</b> menu items
                        </span>
                        <span>
                          <b>{location.configuration.upcomingShowtimes}</b>{" "}
                          upcoming
                        </span>
                        <span
                          className={
                            location.configuration.branding
                              ? "configured"
                              : "needs-attention"
                          }
                        >
                          {location.configuration.branding
                            ? "Brand configured"
                            : "Default brand"}
                        </span>
                      </div>
                      <div className="actions">
                        <a
                          href={CINEMA_ADMIN_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Cinema admin ↗
                        </a>
                        <a
                          href={`${CUSTOMER_WEB_URL.replace(/\/$/, "")}/showtimes?locationId=${encodeURIComponent(location.id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Customer site ↗
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
