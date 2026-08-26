"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { formatPermillePercentage, percentageToPermille } from "./lib/tax-rate";
import { inclusiveReportRange, localDateInputValue } from "./report-range";

type Settings = {
  ticketTypes: Array<{
    id: string;
    name: string;
    priceAdjustmentMinor: number;
    active: boolean;
  }>;
  priceTiers: Array<{
    id: string;
    name: string;
    ticketPriceMinor: number;
    active: boolean;
  }>;
  taxRules: Array<{
    id: string;
    name: string;
    appliesTo: string;
    ratePermille: number;
    active: boolean;
  }>;
  serviceChargeRules: Array<{
    id: string;
    name: string;
    appliesTo: string;
    ratePermille: number | null;
    flatCents: number | null;
    autoApply: boolean;
    active: boolean;
  }>;
};
type People = {
  employees: Array<{
    id: string;
    name: string;
    email: string;
    active: boolean;
    authAccount: { mfaEnabled: boolean } | null;
    employeeRoles: Array<{
      roleId: string;
      role: { key: string; name: string };
    }>;
  }>;
  roles: Array<{
    id: string;
    key: string;
    name: string;
    rolePermissions: Array<{ permission: { key: string } }>;
  }>;
  permissions: Array<{ id: string; key: string; description: string }>;
};
type Refunds = {
  ticketOrders: Array<{
    id: string;
    status: string;
    orderNumber: string;
    totalCents: number;
    guestName: string | null;
    guestEmail: string | null;
    customer: {
      id: string;
      name: string | null;
      email: string | null;
    } | null;
    payment: {
      status: string;
      verificationFailedAt: string | null;
      verificationFailureNote: string | null;
      refunds: RefundAttempt[];
    } | null;
    tickets: Array<{
      id: string;
      showtimeSeat: {
        seat: { label: string };
        showtime: { movie: { title: string } };
      };
    }>;
    cashTransactions: Array<{ type: string; amountCents: number }>;
  }>;
  restaurantTabs: Array<{
    id: string;
    status: string;
    label: string | null;
    totalCents: number | null;
    primaryCustomer: {
      id: string;
      name: string | null;
      email: string | null;
    } | null;
    showtime: { movie: { title: string } } | null;
    receipt: { receiptNumber: string } | null;
    payments: Array<{ status: string; refunds: RefundAttempt[] }>;
  }>;
};

type RefundAttempt = {
  status: string;
  amountCents: number;
  createdAt: string;
  reason: string | null;
  providerRefundId: string | null;
};

const permissionGroups = [
  { label: "Employees & access", prefixes: ["employee."] },
  { label: "Audit", prefixes: ["audit."] },
  {
    label: "Films, showtimes & tickets",
    prefixes: ["auditorium.", "movie.", "showtime.", "seat.", "ticket."],
  },
  {
    label: "Restaurant & menu",
    prefixes: ["restaurant.", "kitchen.", "menu."],
  },
  { label: "Payments", prefixes: ["payment."] },
  { label: "Reports & finance", prefixes: ["reports."] },
  { label: "Other", prefixes: [] },
] as const;

function permissionGroup(key: string) {
  return (
    permissionGroups.find((group) =>
      group.prefixes.some((prefix) => key.startsWith(prefix)),
    )?.label ?? "Other"
  );
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const unresolvedRefund = (status: string) =>
  status === "CREATED" || status === "PROCESSING" || status === "FAILED";
const ticketNeedsAttention = (order: Refunds["ticketOrders"][number]) =>
  Boolean(order.payment?.verificationFailedAt) ||
  Boolean(
    order.payment?.refunds.some((refund) => unresolvedRefund(refund.status)),
  );
const tabNeedsAttention = (tab: Refunds["restaurantTabs"][number]) =>
  tab.status === "MANAGER_REVIEW" ||
  tab.payments.some((payment) =>
    payment.refunds.some((refund) => unresolvedRefund(refund.status)),
  );

type ControlSection = "taxes" | "users" | "refunds";
const taxCategories = [
  { value: "ALL", label: "All" },
  { value: "FOOD", label: "Food" },
  { value: "ALCOHOL", label: "Alcohol" },
  { value: "NA_BEVERAGE", label: "Non-alcoholic beverage" },
] as const;
type TaxCategory = (typeof taxCategories)[number]["value"];

export function ManagementControls({
  accessToken,
  permissions,
  section,
  timeZone,
}: {
  accessToken: string;
  permissions: string[];
  section: ControlSection;
  timeZone: string;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [refunds, setRefunds] = useState<Refunds | null>(null);
  const [refundHistory, setRefundHistory] = useState<Refunds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tax, setTax] = useState({
    name: "",
    appliesTo: ["ALL"] as TaxCategory[],
    ratePercent: "",
  });
  const [taxNameDrafts, setTaxNameDrafts] = useState<Record<string, string>>({});
  const [taxCategoryDrafts, setTaxCategoryDrafts] = useState<Record<string, string>>({});
  const [taxRateDrafts, setTaxRateDrafts] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState({
    name: "",
    appliesTo: "ALL",
    ratePermille: 0,
  });
  const taxAttemptRef = useRef<{
    fingerprint: string;
    requestIds: Record<TaxCategory, string>;
  } | null>(null);
  const updateTaxAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deleteTaxAttemptRef = useRef<{ ruleId: string; requestId: string } | null>(null);
  const chargeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updateChargeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deleteChargeAttemptRef = useRef<{ ruleId: string; requestId: string } | null>(null);
  const checkoutRuleActionRef = useRef(false);
  const [checkoutRuleAction, setCheckoutRuleAction] = useState<{ kind: "create-tax" | "create-service" | "update" | "delete"; id?: string; field?: string } | null>(null);
  const [newPriceTier, setNewPriceTier] = useState({
    name: "Standard",
    price: "",
  });
  const [newTicketTypeName, setNewTicketTypeName] = useState("");
  const [newTicketTypeAdjustment, setNewTicketTypeAdjustment] =
    useState("0.00");
  const priceAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updatePriceAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const bulkPriceAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const ticketTypeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updateTicketTypeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const ticketPricingActionRef = useRef(false);
  const [ticketPricingAction, setTicketPricingAction] = useState<{ kind: "create-price" | "create-type" | "save-price" | "toggle-price" | "bulk-price" | "update-type"; id?: string } | null>(null);
  const [selectedPriceTierIds, setSelectedPriceTierIds] = useState<string[]>([]);
  const [bulkPriceAdjustment, setBulkPriceAdjustment] = useState("");
  const [ticketTypeDrafts, setTicketTypeDrafts] = useState<
    Record<string, string>
  >({});
  const [ticketTypeAdjustmentDrafts, setTicketTypeAdjustmentDrafts] = useState<
    Record<string, string>
  >({});
  const [priceNameDrafts, setPriceNameDrafts] = useState<
    Record<string, string>
  >({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [savedPriceId, setSavedPriceId] = useState<string | null>(null);
  const [employee, setEmployee] = useState({
    name: "",
    email: "",
    password: "",
    pin: "",
    roleId: "",
  });
  const employeeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updateEmployeeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const credentialResetAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const employeeActionRef = useRef(false);
  const [employeeAction, setEmployeeAction] = useState<{ kind: "create" | "update" | "credentials"; id?: string } | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const roleAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const renameRoleAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const rolePermissionsAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deleteRoleAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const roleActionRef = useRef(false);
  const [roleAction, setRoleAction] = useState<"create" | "rename" | "permissions" | "delete" | null>(null);
  const [selectedRoleName, setSelectedRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [employeeRoleDrafts, setEmployeeRoleDrafts] = useState<
    Record<string, string[]>
  >({});
  const [employeeIdentityDrafts, setEmployeeIdentityDrafts] = useState<
    Record<string, { name: string; email: string }>
  >({});
  const [credentialDrafts, setCredentialDrafts] = useState<
    Record<string, { password: string; pin: string }>
  >({});
  const [refundReason, setRefundReason] = useState(
    "Customer-requested full refund",
  );
  const [drawerId, setDrawerId] = useState("");
  const [refundQuery, setRefundQuery] = useState("");
  const [refundPending, setRefundPending] = useState(false);
  const refundAttemptRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const [historyFrom, setHistoryFrom] = useState(() =>
    localDateInputValue(new Date(Date.now() - 30 * 86_400_000), timeZone),
  );
  const [historyTo, setHistoryTo] = useState(() =>
    localDateInputValue(new Date(), timeZone),
  );
  const canConfig = permissions.includes("ticket.price.edit");
  const canMenuConfig = permissions.includes("menu.edit");
  const canPeople = permissions.includes("employee.edit");
  const canPermissions = permissions.includes("employee.permissions.edit");
  const canRefund =
    permissions.includes("payment.refund") ||
    permissions.includes("ticket.refund");
  const refreshRequestRef = useRef(0);

  async function refresh() {
    const requestId = ++refreshRequestRef.current;
    try {
      const [nextSettings, nextPeople, nextRefunds, nextRefundHistory] =
        await Promise.all([
          section === "taxes" && canConfig
            ? apiFetch<Settings>("/management/settings", { accessToken })
            : null,
          section === "users" && canPeople
            ? apiFetch<People>("/management/people", { accessToken })
            : null,
          section === "refunds" && canRefund
            ? apiFetch<Refunds>(
                `/management/refunds${refundQuery.trim() ? `?query=${encodeURIComponent(refundQuery.trim())}` : ""}`,
                { accessToken },
              )
            : null,
          section === "refunds" && canRefund
            ? apiFetch<Refunds>(
                `/management/refunds/history?${new URLSearchParams({ ...inclusiveReportRange(historyFrom, historyTo, timeZone), ...(refundQuery.trim() ? { query: refundQuery.trim() } : {}) }).toString()}`,
                { accessToken },
              )
            : null,
        ]);
      if (requestId !== refreshRequestRef.current) return;
      setSettings(nextSettings);
      setPeople(nextPeople);
      setRefunds(nextRefunds);
      setRefundHistory(nextRefundHistory);
      if (nextSettings) {
        setTaxNameDrafts(
          Object.fromEntries(nextSettings.taxRules.map((rule) => [rule.id, rule.name])),
        );
        setTaxCategoryDrafts(
          Object.fromEntries(nextSettings.taxRules.map((rule) => [rule.id, rule.appliesTo])),
        );
        setTaxRateDrafts(
          Object.fromEntries(
            nextSettings.taxRules.map((rule) => [rule.id, formatPermillePercentage(rule.ratePermille)]),
          ),
        );
        setPriceNameDrafts(
          Object.fromEntries(
            nextSettings.priceTiers.map((tier) => [tier.id, tier.name]),
          ),
        );
        setPriceDrafts(
          Object.fromEntries(
            nextSettings.priceTiers.map((tier) => [
              tier.id,
              (tier.ticketPriceMinor / 100).toFixed(2),
            ]),
          ),
        );
        setTicketTypeDrafts(
          Object.fromEntries(
            nextSettings.ticketTypes.map((ticketType) => [
              ticketType.id,
              ticketType.name,
            ]),
          ),
        );
        setTicketTypeAdjustmentDrafts(
          Object.fromEntries(
            nextSettings.ticketTypes.map((ticketType) => [
              ticketType.id,
              (ticketType.priceAdjustmentMinor / 100).toFixed(2),
            ]),
          ),
        );
      }
      if (nextPeople) {
        if (!selectedRoleId) setSelectedRoleId(nextPeople.roles[0]?.id ?? "");
        setEmployeeRoleDrafts(
          Object.fromEntries(
            nextPeople.employees.map((person) => [
              person.id,
              person.employeeRoles.map((entry) => entry.roleId),
            ]),
          ),
        );
        setEmployeeIdentityDrafts(
          Object.fromEntries(
            nextPeople.employees.map((person) => [
              person.id,
              { name: person.name, email: person.email },
            ]),
          ),
        );
      }
    } catch (reason) {
      if (requestId !== refreshRequestRef.current) return;
      setError(
        reason instanceof ApiRequestError
          ? reason.body.message
          : "Management controls could not be loaded.",
      );
    }
  }
  useEffect(() => {
    void refresh();
    return () => { refreshRequestRef.current += 1; };
  }, [accessToken, section]);

  const selectedRole = useMemo(
    () => people?.roles.find((role) => role.id === selectedRoleId),
    [people, selectedRoleId],
  );
  const groupedPermissions = useMemo(
    () =>
      permissionGroups
        .map((group) => ({
          label: group.label,
          permissions:
            people?.permissions.filter(
              (permission) => permissionGroup(permission.key) === group.label,
            ) ?? [],
        }))
        .filter((group) => group.permissions.length),
    [people],
  );
  useEffect(() => {
    setSelectedPermissions(
      selectedRole?.rolePermissions.map((entry) => entry.permission.key) ?? [],
    );
  }, [selectedRole]);
  useEffect(() => {
    setSelectedRoleName(selectedRole?.name ?? "");
  }, [selectedRole]);

  function setPermissionGroup(keys: string[], enabled: boolean) {
    setSelectedPermissions((current) =>
      enabled
        ? [...new Set([...current, ...keys])]
        : current.filter((key) => !keys.includes(key)),
    );
  }

  function setTaxCategory(category: TaxCategory, checked: boolean) {
    setTax((current) => ({
      ...current,
      appliesTo:
        category === "ALL"
          ? checked
            ? ["ALL"]
            : []
          : checked
            ? [...current.appliesTo.filter((value) => value !== "ALL"), category]
            : current.appliesTo.filter((value) => value !== category),
    }));
  }

  async function createTax(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (checkoutRuleActionRef.current) return;
    let ratePermille: number;
    try {
      ratePermille = percentageToPermille(tax.ratePercent);
    } catch (reason) {
      showError(reason);
      return;
    }
    if (tax.appliesTo.length === 0) {
      setError("Choose at least one tax category.");
      return;
    }
    checkoutRuleActionRef.current = true;
    setCheckoutRuleAction({ kind: "create-tax" });
    const bodies = tax.appliesTo.map((appliesTo) => ({
      name: tax.name,
      appliesTo,
      ratePermille,
      active: true,
    }));
    const fingerprint = JSON.stringify(bodies);
    if (taxAttemptRef.current?.fingerprint !== fingerprint) {
      taxAttemptRef.current = {
        fingerprint,
        requestIds: Object.fromEntries(
          taxCategories.map(({ value }) => [value, crypto.randomUUID()]),
        ) as Record<TaxCategory, string>,
      };
    }
    try {
      await Promise.all(
        bodies.map((body) =>
          apiFetch("/management/settings/tax-rules", {
            accessToken,
            method: "POST",
            headers: {
              "Idempotency-Key": taxAttemptRef.current!.requestIds[body.appliesTo],
            },
            body: JSON.stringify(body),
          }),
        ),
      );
      taxAttemptRef.current = null;
      setTax({ name: "", appliesTo: ["ALL"], ratePercent: "" });
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) taxAttemptRef.current = null;
      showError(reason);
    } finally {
      checkoutRuleActionRef.current = false;
      setCheckoutRuleAction(null);
    }
  }
  async function createPrice(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "create-price" });
    const body = { name: newPriceTier.name, ticketPriceMinor: Math.round(Number(newPriceTier.price) * 100) };
    const fingerprint = JSON.stringify(body);
    if (priceAttemptRef.current?.fingerprint !== fingerprint) priceAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/settings/price-tiers", {
        accessToken,
        method: "POST",
        headers: { "Idempotency-Key": priceAttemptRef.current.requestId },
        body: fingerprint,
      });
      priceAttemptRef.current = null;
      setNewPriceTier({ name: "Standard", price: "" });
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) priceAttemptRef.current = null;
      showError(reason);
    } finally {
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function createTicketType(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "create-type" });
    const body = { name: newTicketTypeName, priceAdjustmentMinor: Math.round(Number(newTicketTypeAdjustment) * 100) };
    const fingerprint = JSON.stringify(body);
    if (ticketTypeAttemptRef.current?.fingerprint !== fingerprint) ticketTypeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/settings/ticket-types", {
        accessToken,
        method: "POST",
        headers: { "Idempotency-Key": ticketTypeAttemptRef.current.requestId },
        body: fingerprint,
      });
      ticketTypeAttemptRef.current = null;
      setNewTicketTypeName("");
      setNewTicketTypeAdjustment("0.00");
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) ticketTypeAttemptRef.current = null;
      showError(reason);
    } finally {
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function updateTicketType(
    ticketType: Settings["ticketTypes"][number],
    changes: { name?: string; priceAdjustmentMinor?: number; active?: boolean },
  ) {
    setError(null);
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "update-type", id: ticketType.id });
    const body = JSON.stringify(changes);
    const fingerprint = `${ticketType.id}:${body}`;
    if (updateTicketTypeAttemptRef.current?.fingerprint !== fingerprint) updateTicketTypeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/settings/ticket-types/${ticketType.id}`, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": updateTicketTypeAttemptRef.current.requestId },
        body,
      });
      updateTicketTypeAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) updateTicketTypeAttemptRef.current = null;
      showError(reason);
    } finally {
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function savePrice(tier: Settings["priceTiers"][number]) {
    const name = priceNameDrafts[tier.id]?.trim();
    const ticketPriceMinor = Math.round(Number(priceDrafts[tier.id]) * 100);
    if (!name) {
      setError("Enter a ticket group name.");
      return;
    }
    if (!Number.isFinite(ticketPriceMinor) || ticketPriceMinor < 0) {
      setError("Enter a valid ticket price.");
      return;
    }
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "save-price", id: tier.id });
    setError(null);
    setSavedPriceId(null);
    setSavingPriceId(tier.id);
    const body = JSON.stringify({ name, ticketPriceMinor });
    const fingerprint = `${tier.id}:${body}`;
    if (updatePriceAttemptRef.current?.fingerprint !== fingerprint) updatePriceAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const updated = await apiFetch<Settings["priceTiers"][number]>(
        `/management/settings/price-tiers/${tier.id}`,
        {
          accessToken,
          method: "PATCH",
          headers: { "Idempotency-Key": updatePriceAttemptRef.current.requestId },
          body,
        },
      );
      setSettings((current) =>
        current
          ? {
              ...current,
              priceTiers: current.priceTiers.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            }
          : current,
      );
      setPriceDrafts((current) => ({
        ...current,
        [updated.id]: (updated.ticketPriceMinor / 100).toFixed(2),
      }));
      setPriceNameDrafts((current) => ({
        ...current,
        [updated.id]: updated.name,
      }));
      setSavedPriceId(updated.id);
      updatePriceAttemptRef.current = null;
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) updatePriceAttemptRef.current = null;
      showError(reason);
    } finally {
      setSavingPriceId(null);
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function togglePriceTier(tier: Settings["priceTiers"][number]) {
    setError(null);
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "toggle-price", id: tier.id });
    setSavingPriceId(tier.id);
    const body = JSON.stringify({ active: !tier.active });
    const fingerprint = `${tier.id}:${body}`;
    if (updatePriceAttemptRef.current?.fingerprint !== fingerprint) updatePriceAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/settings/price-tiers/${tier.id}`, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": updatePriceAttemptRef.current.requestId },
        body,
      });
      updatePriceAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) updatePriceAttemptRef.current = null;
      showError(reason);
    } finally {
      setSavingPriceId(null);
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function bulkAdjustPrices() {
    const adjustmentMinor = Math.round(Number(bulkPriceAdjustment) * 100);
    if (!selectedPriceTierIds.length) { setError("Select at least one ticket group."); return; }
    if (!Number.isFinite(adjustmentMinor) || adjustmentMinor === 0) { setError("Enter a non-zero price adjustment."); return; }
    const selected = settings?.priceTiers.filter((tier) => selectedPriceTierIds.includes(tier.id)) ?? [];
    if (selected.some((tier) => tier.ticketPriceMinor + adjustmentMinor < 0)) { setError("The adjustment would make a selected ticket price negative."); return; }
    if (!window.confirm(`Adjust ${selected.length} ticket ${selected.length === 1 ? "group" : "groups"} by ${money(adjustmentMinor)}?`)) return;
    if (ticketPricingActionRef.current) return;
    ticketPricingActionRef.current = true;
    setTicketPricingAction({ kind: "bulk-price" });
    setError(null);
    const body = JSON.stringify({ priceTierIds: [...selectedPriceTierIds].sort(), adjustmentMinor });
    if (bulkPriceAttemptRef.current?.fingerprint !== body) bulkPriceAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/settings/price-tiers/bulk", { accessToken, method: "PATCH", headers: { "Idempotency-Key": bulkPriceAttemptRef.current.requestId }, body });
      bulkPriceAttemptRef.current = null;
      setSelectedPriceTierIds([]);
      setBulkPriceAdjustment("");
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) bulkPriceAttemptRef.current = null;
      showError(reason);
    } finally {
      ticketPricingActionRef.current = false;
      setTicketPricingAction(null);
    }
  }
  async function createCharge(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (checkoutRuleActionRef.current) return;
    checkoutRuleActionRef.current = true;
    setCheckoutRuleAction({ kind: "create-service" });
    const body = { ...charge, active: true, autoApply: true };
    const fingerprint = JSON.stringify(body);
    if (chargeAttemptRef.current?.fingerprint !== fingerprint) chargeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/settings/service-charge-rules", {
        accessToken,
        method: "POST",
        headers: { "Idempotency-Key": chargeAttemptRef.current.requestId },
        body: fingerprint,
      });
      chargeAttemptRef.current = null;
      setCharge({ name: "", appliesTo: "ALL", ratePermille: 0 });
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) chargeAttemptRef.current = null;
      showError(reason);
    } finally {
      checkoutRuleActionRef.current = false;
      setCheckoutRuleAction(null);
    }
  }
  async function updateRule(
    kind: "tax" | "service",
    id: string,
    changes: Record<string, string | number | boolean>,
  ) {
    setError(null);
    if (checkoutRuleActionRef.current) return;
    checkoutRuleActionRef.current = true;
    setCheckoutRuleAction({ kind: "update", id, field: Object.keys(changes)[0] });
    const body = JSON.stringify(changes);
    const fingerprint = `${id}:${body}`;
    if (kind === "tax" && updateTaxAttemptRef.current?.fingerprint !== fingerprint) updateTaxAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    if (kind === "service" && updateChargeAttemptRef.current?.fingerprint !== fingerprint) updateChargeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const path =
        kind === "tax"
          ? `/management/settings/tax-rules/${id}`
          : `/management/settings/service-charge-rules/${id}`;
      await apiFetch(path, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": kind === "tax" ? updateTaxAttemptRef.current!.requestId : updateChargeAttemptRef.current!.requestId },
        body,
      });
      if (kind === "tax") updateTaxAttemptRef.current = null;
      if (kind === "service") updateChargeAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (kind === "tax" && reason instanceof ApiRequestError && reason.status < 500) updateTaxAttemptRef.current = null;
      if (kind === "service" && reason instanceof ApiRequestError && reason.status < 500) updateChargeAttemptRef.current = null;
      showError(reason);
    } finally {
      checkoutRuleActionRef.current = false;
      setCheckoutRuleAction(null);
    }
  }

  async function saveTaxRule(rule: Settings["taxRules"][number]) {
    const name = taxNameDrafts[rule.id]?.trim();
    if (!name) {
      setError("Enter a tax rule name.");
      return;
    }
    let ratePermille: number;
    try {
      ratePermille = percentageToPermille(taxRateDrafts[rule.id] ?? "");
    } catch (reason) {
      showError(reason);
      return;
    }
    await updateRule("tax", rule.id, {
      name,
      appliesTo: taxCategoryDrafts[rule.id] ?? rule.appliesTo,
      ratePermille,
    });
  }
  async function deleteRule(kind: "tax" | "service", id: string, name: string) {
    if (!window.confirm(`Permanently delete ${name}? This removes the rule from future orders and cannot be undone.`)) return;
    setError(null);
    if (checkoutRuleActionRef.current) return;
    checkoutRuleActionRef.current = true;
    setCheckoutRuleAction({ kind: "delete", id });
    const attemptRef = kind === "tax" ? deleteTaxAttemptRef : deleteChargeAttemptRef;
    if (attemptRef.current?.ruleId !== id) attemptRef.current = { ruleId: id, requestId: crypto.randomUUID() };
    try {
      await apiFetch(
        kind === "tax"
          ? `/management/settings/tax-rules/${id}`
          : `/management/settings/service-charge-rules/${id}`,
        { accessToken, method: "DELETE", headers: { "Idempotency-Key": attemptRef.current.requestId } },
      );
      attemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) attemptRef.current = null;
      showError(reason);
    } finally {
      checkoutRuleActionRef.current = false;
      setCheckoutRuleAction(null);
    }
  }
  async function createEmployee(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (employeeActionRef.current) return;
    employeeActionRef.current = true;
    setEmployeeAction({ kind: "create" });
    const body = JSON.stringify({ name: employee.name, email: employee.email, password: employee.password, pin: employee.pin || undefined, roleIds: [employee.roleId] });
    if (employeeAttemptRef.current?.fingerprint !== body) employeeAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/employees", {
        accessToken,
        method: "POST",
        headers: { "Idempotency-Key": employeeAttemptRef.current.requestId },
        body,
      });
      employeeAttemptRef.current = null;
      setEmployee({ name: "", email: "", password: "", pin: "", roleId: "" });
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) employeeAttemptRef.current = null;
      showError(reason);
    } finally {
      employeeActionRef.current = false;
      setEmployeeAction(null);
    }
  }
  async function saveRole() {
    if (!selectedRoleId) return;
    if (roleActionRef.current || employeeActionRef.current) return;
    roleActionRef.current = true;
    setRoleAction("permissions");
    const body = JSON.stringify({ permissionKeys: selectedPermissions });
    const fingerprint = `${selectedRoleId}:${body}`;
    if (rolePermissionsAttemptRef.current?.fingerprint !== fingerprint) rolePermissionsAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/roles/${selectedRoleId}/permissions`, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": rolePermissionsAttemptRef.current.requestId },
        body,
      });
      rolePermissionsAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) rolePermissionsAttemptRef.current = null;
      showError(reason);
    } finally {
      roleActionRef.current = false;
      setRoleAction(null);
    }
  }
  async function createRole(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (roleActionRef.current || employeeActionRef.current) return;
    roleActionRef.current = true;
    setRoleAction("create");
    const body = JSON.stringify({ name: newRoleName });
    if (roleAttemptRef.current?.fingerprint !== body) roleAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    try {
      const created = await apiFetch<{ id: string }>("/management/roles", {
        accessToken,
        method: "POST",
        headers: { "Idempotency-Key": roleAttemptRef.current.requestId },
        body,
      });
      roleAttemptRef.current = null;
      setNewRoleName("");
      await refresh();
      setSelectedRoleId(created.id);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) roleAttemptRef.current = null;
      showError(reason);
    } finally {
      roleActionRef.current = false;
      setRoleAction(null);
    }
  }
  async function renameRole() {
    if (!selectedRole?.key.startsWith("CUSTOM_")) return;
    if (roleActionRef.current || employeeActionRef.current) return;
    roleActionRef.current = true;
    setRoleAction("rename");
    const body = JSON.stringify({ name: selectedRoleName });
    const fingerprint = `${selectedRole.id}:${body}`;
    if (renameRoleAttemptRef.current?.fingerprint !== fingerprint) renameRoleAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/roles/${selectedRole.id}`, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": renameRoleAttemptRef.current.requestId },
        body,
      });
      renameRoleAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) renameRoleAttemptRef.current = null;
      showError(reason);
    } finally {
      roleActionRef.current = false;
      setRoleAction(null);
    }
  }
  async function deleteRole() {
    if (
      !selectedRole?.key.startsWith("CUSTOM_") ||
      !window.confirm(
        `Delete the role “${selectedRole.name}”? This cannot be undone.`,
      )
    )
      return;
    if (roleActionRef.current || employeeActionRef.current) return;
    roleActionRef.current = true;
    setRoleAction("delete");
    const fingerprint = selectedRole.id;
    if (deleteRoleAttemptRef.current?.fingerprint !== fingerprint) deleteRoleAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/roles/${selectedRole.id}`, {
        accessToken,
        method: "DELETE",
        headers: { "Idempotency-Key": deleteRoleAttemptRef.current.requestId },
      });
      deleteRoleAttemptRef.current = null;
      const fallbackId =
        people?.roles.find((role) => role.id !== selectedRole.id)?.id ?? "";
      setSelectedRoleId(fallbackId);
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) deleteRoleAttemptRef.current = null;
      showError(reason);
    } finally {
      roleActionRef.current = false;
      setRoleAction(null);
    }
  }
  async function submitEmployeeUpdate(targetId: string, changes: object) {
    if (employeeActionRef.current || roleActionRef.current) return false;
    employeeActionRef.current = true;
    setEmployeeAction({ kind: "update", id: targetId });
    const body = JSON.stringify(changes);
    const fingerprint = `${targetId}:${body}`;
    if (updateEmployeeAttemptRef.current?.fingerprint !== fingerprint) updateEmployeeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/employees/${targetId}`, { accessToken, method: "PATCH", headers: { "Idempotency-Key": updateEmployeeAttemptRef.current.requestId }, body });
      updateEmployeeAttemptRef.current = null;
      await refresh();
      return true;
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) updateEmployeeAttemptRef.current = null;
      throw reason;
    } finally {
      employeeActionRef.current = false;
      setEmployeeAction(null);
    }
  }
  async function toggleEmployee(target: People["employees"][number]) {
    try {
      await submitEmployeeUpdate(target.id, { active: !target.active });
    } catch (reason) {
      showError(reason);
    }
  }
  async function saveEmployeeIdentity(target: People["employees"][number]) {
    const draft = employeeIdentityDrafts[target.id];
    if (!draft?.name.trim() || !draft.email.trim()) {
      setError("Employee name and email are required.");
      return;
    }
    try {
      await submitEmployeeUpdate(target.id, { name: draft.name, email: draft.email });
    } catch (reason) {
      showError(reason);
    }
  }
  async function saveEmployeeRoles(target: People["employees"][number]) {
    const roleIds = employeeRoleDrafts[target.id] ?? [];
    if (!roleIds.length) {
      setError("Every employee must retain at least one role.");
      return;
    }
    try {
      await submitEmployeeUpdate(target.id, { roleIds });
    } catch (reason) {
      showError(reason);
    }
  }
  async function resetEmployeeCredentials(
    target: People["employees"][number],
    field: "password" | "pin",
    removePin = false,
  ) {
    const draft = credentialDrafts[target.id] ?? { password: "", pin: "" };
    if (field === "password" && draft.password.length < 12) {
      setError("Temporary passwords must contain at least 12 characters.");
      return;
    }
    if (field === "pin" && !removePin && !/^\d{4,8}$/.test(draft.pin)) {
      setError("PINs must contain 4 to 8 digits.");
      return;
    }
    if (
      !window.confirm(
        `${removePin ? "Remove the PIN for" : `Reset ${field} for`} ${target.name}? Existing sessions will not be able to refresh.`,
      )
    )
      return;
    if (employeeActionRef.current) return;
    employeeActionRef.current = true;
    setEmployeeAction({ kind: "credentials", id: target.id });
    const body = JSON.stringify(field === "password" ? { password: draft.password } : { pin: removePin ? null : draft.pin });
    const fingerprint = `${target.id}:${body}`;
    if (credentialResetAttemptRef.current?.fingerprint !== fingerprint) credentialResetAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/employees/${target.id}/credentials`, {
        accessToken,
        method: "PATCH",
        headers: { "Idempotency-Key": credentialResetAttemptRef.current.requestId },
        body,
      });
      credentialResetAttemptRef.current = null;
      setCredentialDrafts((current) => ({
        ...current,
        [target.id]: { password: "", pin: "" },
      }));
      setError(null);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) credentialResetAttemptRef.current = null;
      showError(reason);
    } finally {
      employeeActionRef.current = false;
      setEmployeeAction(null);
    }
  }
  async function refund(
    scope: "ticket" | "restaurant",
    id: string,
    cashRequired = false,
  ) {
    if (refundPending) return;
    if (!window.confirm(`Issue a full ${scope} refund? This cannot be undone.`))
      return;
    const cashDrawerId = cashRequired && drawerId ? drawerId : undefined;
    const fingerprint = JSON.stringify({
      scope,
      id,
      reason: refundReason,
      cashDrawerId,
    });
    if (refundAttemptRef.current?.fingerprint !== fingerprint) {
      refundAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    const requestId = refundAttemptRef.current.requestId;
    let refundApplied = false;
    setRefundPending(true);
    try {
      const path =
        scope === "ticket"
          ? `/management/refunds/ticket-orders/${id}`
          : `/management/refunds/restaurant-tabs/${id}`;
      await apiFetch(path, {
        accessToken,
        method: "POST",
        body: JSON.stringify({
          requestId,
          reason: refundReason,
          ...(cashDrawerId ? { cashDrawerId } : {}),
        }),
      });
      refundApplied = true;
      await refresh();
      refundAttemptRef.current = null;
    } catch (reason) {
      if (
        !refundApplied &&
        reason instanceof ApiRequestError &&
        reason.status < 500
      ) {
        refundAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      setRefundPending(false);
    }
  }
  function showError(reason: unknown) {
    setError(
      reason instanceof ApiRequestError
        ? reason.body.message
        : "The action could not be completed.",
    );
  }

  return (
    <section className="management-stack">
      {error && <div className="error-banner">{error}</div>}
      {section === "taxes" && (canConfig || canMenuConfig) && (
        <section className="admin-grid pricing-settings-grid">
          {canConfig && (
            <form
              className="panel"
              onSubmit={(event) => void createTicketType(event)}
            >
              <p className="kicker">TICKET TYPES</p>
              <h2>Checkout options</h2>
              <p className="muted">
                These labels appear during customer and box-office checkout. At
                least one must remain active.
              </p>
              <div className="rule-list">
                {settings?.ticketTypes.map((ticketType) => (
                  <article key={ticketType.id}>
                    <div>
                      <strong>{ticketType.name}</strong>
                      <span>{ticketType.active ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="rule-actions">
                      <label>
                        Name
                        <input
                          required
                          maxLength={100}
                          value={ticketTypeDrafts[ticketType.id] ?? ""}
                          onChange={(event) =>
                            setTicketTypeDrafts((current) => ({
                              ...current,
                              [ticketType.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Price adjustment
                        <input type="number" step="0.01" value={ticketTypeAdjustmentDrafts[ticketType.id] ?? ""} onChange={(event) => setTicketTypeAdjustmentDrafts((current) => ({ ...current, [ticketType.id]: event.target.value }))} />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          ticketPricingAction !== null ||
                          !ticketTypeDrafts[ticketType.id]?.trim() ||
                          !Number.isFinite(Number(ticketTypeAdjustmentDrafts[ticketType.id]))
                        }
                        onClick={() =>
                          void updateTicketType(ticketType, {
                            name: ticketTypeDrafts[ticketType.id]?.trim(),
                            priceAdjustmentMinor: Math.round(Number(ticketTypeAdjustmentDrafts[ticketType.id]) * 100),
                          })
                        }
                      >
                        {ticketPricingAction?.kind === "update-type" && ticketPricingAction.id === ticketType.id ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={ticketPricingAction !== null}
                        onClick={() =>
                          void updateTicketType(ticketType, {
                            active: !ticketType.active,
                          })
                        }
                      >
                        {ticketPricingAction?.kind === "update-type" && ticketPricingAction.id === ticketType.id ? "Updating…" : ticketType.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <hr />
              <h3>Add ticket type</h3>
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  value={newTicketTypeName}
                  onChange={(event) => setNewTicketTypeName(event.target.value)}
                  placeholder="Adult, Senior, Member…"
                />
              </label>
              <label>
                Price adjustment
                <input required type="number" step="0.01" value={newTicketTypeAdjustment} onChange={(event) => setNewTicketTypeAdjustment(event.target.value)} />
              </label>
              <button className="primary" disabled={ticketPricingAction !== null}>{ticketPricingAction?.kind === "create-type" ? "Adding…" : "Add ticket type"}</button>
            </form>
          )}
          {canConfig && (
            <form
              className="panel"
              onSubmit={(event) => void createPrice(event)}
            >
              <p className="kicker">TICKET PRICES</p>
              <h2>Admission pricing</h2>
              <p className="muted">
                Set the admission amount for each ticket group. Ringo’s
                per-ticket fee is controlled separately by Master. At least one
                group must remain active.
              </p>
              <fieldset className="bulk-price-editor">
                <legend>Bulk price adjustment</legend>
                <p className="muted">Select ticket groups below, then raise or lower each current price by the same amount.</p>
                <label>Adjustment
                  <input type="number" step="0.01" value={bulkPriceAdjustment} onChange={(event) => setBulkPriceAdjustment(event.target.value)} placeholder="1.00 or -1.00" />
                </label>
                <button type="button" className="secondary" disabled={ticketPricingAction !== null || !selectedPriceTierIds.length || !bulkPriceAdjustment} onClick={() => void bulkAdjustPrices()}>{ticketPricingAction?.kind === "bulk-price" ? "Adjusting…" : `Adjust ${selectedPriceTierIds.length || "selected"}`}</button>
              </fieldset>
              <div className="rule-list">
                {settings?.priceTiers.map((tier) => (
                  <article key={tier.id}>
                    <div>
                      <label className="check"><input type="checkbox" checked={selectedPriceTierIds.includes(tier.id)} onChange={(event) => setSelectedPriceTierIds((current) => event.target.checked ? [...current, tier.id] : current.filter((id) => id !== tier.id))} /><strong>{tier.name}</strong></label>
                      <span aria-live="polite">
                        {savedPriceId === tier.id
                          ? "Changes saved"
                          : tier.active
                            ? "Active"
                            : "Inactive"}
                      </span>
                    </div>
                    <div className="rule-actions">
                      <label>
                        Name
                        <input
                          required
                          maxLength={100}
                          value={priceNameDrafts[tier.id] ?? ""}
                          onChange={(event) => {
                            setSavedPriceId(null);
                            setPriceNameDrafts((current) => ({
                              ...current,
                              [tier.id]: event.target.value,
                            }));
                          }}
                        />
                      </label>
                      <label>
                        Price
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={priceDrafts[tier.id] ?? ""}
                          onChange={(event) => {
                            setSavedPriceId(null);
                            setPriceDrafts((current) => ({
                              ...current,
                              [tier.id]: event.target.value,
                            }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          ticketPricingAction !== null ||
                          !priceNameDrafts[tier.id]?.trim()
                        }
                        onClick={() => void savePrice(tier)}
                      >
                        {savingPriceId === tier.id ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={ticketPricingAction !== null}
                        onClick={() => void togglePriceTier(tier)}
                      >
                        {ticketPricingAction?.kind === "toggle-price" && ticketPricingAction.id === tier.id ? "Updating…" : tier.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <hr />
              <h3>Add ticket group</h3>
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  value={newPriceTier.name}
                  onChange={(event) =>
                    setNewPriceTier({
                      ...newPriceTier,
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Ticket price
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPriceTier.price}
                  onChange={(event) =>
                    setNewPriceTier({
                      ...newPriceTier,
                      price: event.target.value,
                    })
                  }
                />
              </label>
              <button className="primary" disabled={ticketPricingAction !== null}>{ticketPricingAction?.kind === "create-price" ? "Adding…" : "Add ticket group"}</button>
            </form>
          )}
          {canMenuConfig && (
            <form className="panel checkout-rules-panel" onSubmit={(event) => void createTax(event)}>
              <p className="kicker">TAX RULES</p>
              <h2>Add restaurant tax</h2>
              <label>
                Name
                <input
                  required
                  value={tax.name}
                  onChange={(event) =>
                    setTax({ ...tax, name: event.target.value })
                  }
                />
              </label>
              <fieldset>
                <legend>Categories</legend>
                {taxCategories.map((category) => (
                  <label className="check" key={category.value}>
                    <input
                      type="checkbox"
                      checked={tax.appliesTo.includes(category.value)}
                      onChange={(event) =>
                        setTaxCategory(category.value, event.target.checked)
                      }
                    />
                    {category.label}
                  </label>
                ))}
              </fieldset>
              <label>
                Rate (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  inputMode="decimal"
                  placeholder="9.75"
                  value={tax.ratePercent}
                  onChange={(event) =>
                    setTax({ ...tax, ratePercent: event.target.value })
                  }
                />
              </label>
              <button className="primary" disabled={checkoutRuleAction !== null}>{checkoutRuleAction?.kind === "create-tax" ? "Adding…" : "Add tax rule"}</button>
              <div className="rule-list">
                {settings?.taxRules.map((rule) => (
                  <article key={rule.id}>
                    <div>
                      <strong>{rule.name}</strong>
                      <span>
                        {formatPermillePercentage(rule.ratePermille)}% ·{" "}
                        {rule.appliesTo}
                      </span>
                    </div>
                    <div className="rule-actions checkout-rule-editor">
                      <label>
                        Name
                        <input
                          required
                          maxLength={100}
                          value={taxNameDrafts[rule.id] ?? ""}
                          onChange={(event) =>
                            setTaxNameDrafts((current) => ({
                              ...current,
                              [rule.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Category
                        <select
                          value={taxCategoryDrafts[rule.id] ?? rule.appliesTo}
                          onChange={(event) =>
                            setTaxCategoryDrafts((current) => ({
                              ...current,
                              [rule.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="ALL">All</option>
                          <option value="FOOD">Food</option>
                          <option value="ALCOHOL">Alcohol</option>
                          <option value="NA_BEVERAGE">Non-alcoholic beverage</option>
                        </select>
                      </label>
                      <label>
                        Rate (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          required
                          inputMode="decimal"
                          value={taxRateDrafts[rule.id] ?? ""}
                          onChange={(event) =>
                            setTaxRateDrafts((current) => ({
                              ...current,
                              [rule.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={checkoutRuleAction !== null || !taxNameDrafts[rule.id]?.trim()}
                        onClick={() => void saveTaxRule(rule)}
                      >
                        {checkoutRuleAction?.kind === "update" && checkoutRuleAction.id === rule.id ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={checkoutRuleAction !== null}
                        onClick={() =>
                          void updateRule("tax", rule.id, {
                            active: !rule.active,
                          })
                        }
                      >
                        {checkoutRuleAction?.kind === "update" && checkoutRuleAction.id === rule.id ? "Updating…" : rule.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="secondary destructive-outline"
                        disabled={checkoutRuleAction !== null}
                        onClick={() => void deleteRule("tax", rule.id, rule.name)}
                      >
                        {checkoutRuleAction?.kind === "delete" && checkoutRuleAction.id === rule.id ? "Deleting…" : "Delete permanently"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </form>
          )}
          {canMenuConfig && (
            <form
              className="panel checkout-rules-panel"
              onSubmit={(event) => void createCharge(event)}
            >
              <p className="kicker">SERVICE CHARGES</p>
              <h2>Add automatic charge</h2>
              <label>
                Name
                <input
                  required
                  value={charge.name}
                  onChange={(event) =>
                    setCharge({ ...charge, name: event.target.value })
                  }
                />
              </label>
              <label>
                Category
                <select
                  value={charge.appliesTo}
                  onChange={(event) =>
                    setCharge({ ...charge, appliesTo: event.target.value })
                  }
                >
                  <option value="ALL">All</option>
                  <option value="FOOD">Food</option>
                  <option value="ALCOHOL">Alcohol</option>
                  <option value="NA_BEVERAGE">Non-alcoholic beverage</option>
                </select>
              </label>
              <label>
                Rate in tenths of a percent
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={charge.ratePermille}
                  onChange={(event) =>
                    setCharge({
                      ...charge,
                      ratePermille: Number(event.target.value),
                    })
                  }
                />
              </label>
              <button className="primary" disabled={checkoutRuleAction !== null}>{checkoutRuleAction?.kind === "create-service" ? "Adding…" : "Add service charge"}</button>
              <div className="rule-list">
                {settings?.serviceChargeRules.map((rule) => (
                  <article key={rule.id}>
                    <div>
                      <strong>{rule.name}</strong>
                      <span>
                        {rule.ratePermille != null
                          ? `${(rule.ratePermille / 10).toFixed(1)}%`
                          : money(rule.flatCents ?? 0)}{" "}
                        · {rule.appliesTo}
                        {rule.active ? "" : " · INACTIVE"}
                      </span>
                    </div>
                    <div className="rule-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={checkoutRuleAction !== null || !rule.active}
                        onClick={() =>
                          void updateRule("service", rule.id, {
                            autoApply: !rule.autoApply,
                          })
                        }
                      >
                        {checkoutRuleAction?.kind === "update" && checkoutRuleAction.id === rule.id && checkoutRuleAction.field === "autoApply" ? "Updating…" : rule.autoApply ? "Automatic" : "Not applied"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={checkoutRuleAction !== null}
                        onClick={() =>
                          void updateRule("service", rule.id, {
                            active: !rule.active,
                          })
                        }
                      >
                        {checkoutRuleAction?.kind === "update" && checkoutRuleAction.id === rule.id && checkoutRuleAction.field === "active" ? "Updating…" : rule.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="secondary destructive-outline"
                        disabled={checkoutRuleAction !== null}
                        onClick={() => void deleteRule("service", rule.id, rule.name)}
                      >
                        {checkoutRuleAction?.kind === "delete" && checkoutRuleAction.id === rule.id ? "Deleting…" : "Delete permanently"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </form>
          )}
        </section>
      )}

      {people && (
        <section className="admin-grid">
          <form
            className="panel"
            onSubmit={(event) => void createEmployee(event)}
          >
            <p className="kicker">USERS</p>
            <h2>Add employee</h2>
            <label>
              Name
              <input
                required
                value={employee.name}
                onChange={(event) =>
                  setEmployee({ ...employee, name: event.target.value })
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                value={employee.email}
                onChange={(event) =>
                  setEmployee({ ...employee, email: event.target.value })
                }
              />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                minLength={12}
                required
                value={employee.password}
                onChange={(event) =>
                  setEmployee({ ...employee, password: event.target.value })
                }
              />
            </label>
            <label>
              PIN (optional)
              <input
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                value={employee.pin}
                onChange={(event) =>
                  setEmployee({ ...employee, pin: event.target.value })
                }
              />
            </label>
            <label>
              Role
              <select
                required
                value={employee.roleId}
                onChange={(event) =>
                  setEmployee({ ...employee, roleId: event.target.value })
                }
              >
                <option value="">Select a role</option>
                {people.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={employeeAction !== null}>{employeeAction?.kind === "create" ? "Creating…" : "Create employee"}</button>
            <div className="people-list employee-credential-list">
              {people.employees.map((person) => {
                const draft = credentialDrafts[person.id] ?? {
                  password: "",
                  pin: "",
                };
                const identity = employeeIdentityDrafts[person.id] ?? {
                  name: person.name,
                  email: person.email,
                };
                return (
                  <article key={person.id}>
                    <div className="employee-summary">
                      <strong>{person.name}</strong>
                      <span>
                        {person.email} ·{" "}
                        {person.employeeRoles
                          .map((entry) => entry.role.name)
                          .join(", ")}
                      </span>
                      <div className="employee-identity-fields">
                        <label>
                          Name
                          <input
                            required
                            maxLength={100}
                            value={identity.name}
                            onChange={(event) =>
                              setEmployeeIdentityDrafts((current) => ({
                                ...current,
                                [person.id]: {
                                  ...identity,
                                  name: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          Email
                          <input
                            required
                            type="email"
                            value={identity.email}
                            onChange={(event) =>
                              setEmployeeIdentityDrafts((current) => ({
                                ...current,
                                [person.id]: {
                                  ...identity,
                                  email: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            employeeAction !== null ||
                            identity.name === person.name &&
                            identity.email === person.email
                          }
                          onClick={() => void saveEmployeeIdentity(person)}
                        >
                          {employeeAction?.kind === "update" && employeeAction.id === person.id ? "Saving…" : "Save profile"}
                        </button>
                      </div>
                      <div className="credential-reset-fields">
                        <label>
                          Temporary password
                          <input
                            type="password"
                            minLength={12}
                            value={draft.password}
                            onChange={(event) =>
                              setCredentialDrafts((current) => ({
                                ...current,
                                [person.id]: {
                                  ...draft,
                                  password: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          disabled={employeeAction !== null}
                          onClick={() =>
                            void resetEmployeeCredentials(person, "password")
                          }
                        >
                          {employeeAction?.kind === "credentials" && employeeAction.id === person.id ? "Updating…" : "Reset password"}
                        </button>
                        <label>
                          New PIN
                          <input
                            inputMode="numeric"
                            pattern="[0-9]{4,8}"
                            value={draft.pin}
                            onChange={(event) =>
                              setCredentialDrafts((current) => ({
                                ...current,
                                [person.id]: {
                                  ...draft,
                                  pin: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary"
                          disabled={employeeAction !== null}
                          onClick={() =>
                            void resetEmployeeCredentials(person, "pin")
                          }
                        >
                          Set PIN
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={employeeAction !== null}
                          onClick={() =>
                            void resetEmployeeCredentials(person, "pin", true)
                          }
                        >
                          Remove PIN
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={employeeAction !== null}
                      onClick={() => void toggleEmployee(person)}
                    >
                      {employeeAction?.kind === "update" && employeeAction.id === person.id ? "Updating…" : person.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </article>
                );
              })}
            </div>
          </form>
          {canPermissions && (
            <div className="panel">
              <p className="kicker">EMPLOYEE ROLES</p>
              <h2>Assign roles</h2>
              <form
                className="custom-role-form"
                onSubmit={(event) => void createRole(event)}
              >
                <label>
                  New role name
                  <input
                    required
                    maxLength={100}
                    value={newRoleName}
                    onChange={(event) => setNewRoleName(event.target.value)}
                    placeholder="Floor manager"
                  />
                </label>
                <button className="secondary" disabled={roleAction !== null || employeeAction !== null}>{roleAction === "create" ? "Creating…" : "Create role"}</button>
              </form>
              <div className="role-assignment-list">
                {people.employees.map((person) => (
                  <article key={person.id}>
                    <strong>{person.name}</strong>
                    <div className="permission-list">
                      {people.roles.map((role) => (
                        <label className="checkbox" key={role.id}>
                          <input
                            type="checkbox"
                            checked={(
                              employeeRoleDrafts[person.id] ?? []
                            ).includes(role.id)}
                            onChange={(event) =>
                              setEmployeeRoleDrafts((current) => ({
                                ...current,
                                [person.id]: event.target.checked
                                  ? [...(current[person.id] ?? []), role.id]
                                  : (current[person.id] ?? []).filter(
                                      (id) => id !== role.id,
                                    ),
                              }))
                            }
                          />
                          <span>{role.name}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      disabled={employeeAction !== null || roleAction !== null}
                      onClick={() => void saveEmployeeRoles(person)}
                    >
                      {employeeAction?.kind === "update" && employeeAction.id === person.id ? "Saving…" : "Save roles"}
                    </button>
                  </article>
                ))}
              </div>
              <hr />
              <p className="kicker">PERMISSIONS</p>
              <h2>Role access</h2>
              <label>
                Role
                <select
                  value={selectedRoleId}
                  onChange={(event) => setSelectedRoleId(event.target.value)}
                >
                  {people.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedRole?.key.startsWith("CUSTOM_") && (
                <div className="custom-role-form role-lifecycle">
                  <label>
                    Custom role name
                    <input
                      required
                      maxLength={100}
                      value={selectedRoleName}
                      onChange={(event) =>
                        setSelectedRoleName(event.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      roleAction !== null || employeeAction !== null ||
                      !selectedRoleName.trim() ||
                      selectedRoleName.trim() === selectedRole.name
                    }
                    onClick={() => void renameRole()}
                  >
                    {roleAction === "rename" ? "Renaming…" : "Rename"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={roleAction !== null || employeeAction !== null}
                    onClick={() => void deleteRole()}
                  >
                    {roleAction === "delete" ? "Deleting…" : "Delete"}
                  </button>
                </div>
              )}
              <div className="permission-groups">
                {groupedPermissions.map((group) => {
                  const keys = group.permissions.map(
                    (permission) => permission.key,
                  );
                  const allSelected = keys.every((key) =>
                    selectedPermissions.includes(key),
                  );
                  return (
                    <section className="permission-group" key={group.label}>
                      <div className="permission-group-heading">
                        <div>
                          <h3>{group.label}</h3>
                          <small>
                            {
                              keys.filter((key) =>
                                selectedPermissions.includes(key),
                              ).length
                            }{" "}
                            of {keys.length} enabled
                          </small>
                        </div>
                        <button
                          type="button"
                          className="secondary"
                          disabled={roleAction !== null || employeeAction !== null}
                          onClick={() => setPermissionGroup(keys, !allSelected)}
                        >
                          {allSelected ? "Clear group" : "Select group"}
                        </button>
                      </div>
                      <div className="permission-list">
                        {group.permissions.map((permission) => (
                          <label className="checkbox" key={permission.id}>
                            <input
                              type="checkbox"
                              checked={selectedPermissions.includes(
                                permission.key,
                              )}
                              onChange={(event) =>
                                setSelectedPermissions(
                                  event.target.checked
                                    ? [...selectedPermissions, permission.key]
                                    : selectedPermissions.filter(
                                        (key) => key !== permission.key,
                                      ),
                                )
                              }
                            />
                            <span>
                              <strong>{permission.key}</strong>
                              <small>{permission.description}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              <button className="primary" disabled={roleAction !== null || employeeAction !== null} onClick={() => void saveRole()}>
                {roleAction === "permissions" ? "Saving…" : "Save role permissions"}
              </button>
            </div>
          )}
        </section>
      )}

      {refunds && (
        <RefundWorkbench
          refunds={refunds}
          history={refundHistory}
          refundReason={refundReason}
          drawerId={drawerId}
          query={refundQuery}
          onReasonChange={setRefundReason}
          onDrawerChange={setDrawerId}
          onQueryChange={setRefundQuery}
          onSearch={() => void refresh()}
          historyFrom={historyFrom}
          historyTo={historyTo}
          timeZone={timeZone}
          onHistoryFromChange={setHistoryFrom}
          onHistoryToChange={setHistoryTo}
          refundPending={refundPending}
          onRefund={(scope, id, cashRequired) =>
            void refund(scope, id, cashRequired)
          }
        />
      )}
    </section>
  );
}

function RefundWorkbench({
  refunds,
  history,
  refundReason,
  drawerId,
  query,
  historyFrom,
  historyTo,
  timeZone,
  onReasonChange,
  onDrawerChange,
  onQueryChange,
  onHistoryFromChange,
  onHistoryToChange,
  onSearch,
  onRefund,
  refundPending,
}: {
  refunds: Refunds;
  history: Refunds | null;
  refundReason: string;
  drawerId: string;
  query: string;
  historyFrom: string;
  historyTo: string;
  timeZone: string;
  onReasonChange: (value: string) => void;
  onDrawerChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onHistoryFromChange: (value: string) => void;
  onHistoryToChange: (value: string) => void;
  onSearch: () => void;
  refundPending: boolean;
  onRefund: (
    scope: "ticket" | "restaurant",
    id: string,
    cashRequired?: boolean,
  ) => void;
}) {
  const ticketOrders = [...refunds.ticketOrders].sort(
    (left, right) =>
      Number(ticketNeedsAttention(right)) - Number(ticketNeedsAttention(left)),
  );
  const restaurantTabs = [...refunds.restaurantTabs].sort(
    (left, right) =>
      Number(tabNeedsAttention(right)) - Number(tabNeedsAttention(left)),
  );
  const attentionCount =
    ticketOrders.filter(ticketNeedsAttention).length +
    restaurantTabs.filter(tabNeedsAttention).length;

  return (
    <section className="panel refund-workbench">
      <p className="kicker">REFUNDS</p>
      <div className="refund-heading">
        <div>
          <h2>Full-refund workbench</h2>
          <p className="muted">
            Attention items stay at the top and retain their processor-attempt
            history.
          </p>
        </div>
        <strong
          className={attentionCount ? "attention-summary" : "status-chip"}
        >
          {attentionCount
            ? `${attentionCount} need attention`
            : "No attention items"}
        </strong>
      </div>
      <form
        className="refund-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label>
          Find an order or guest
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Order number, receipt, name, or email"
          />
        </label>
        <button className="secondary">Search</button>
      </form>
      <div className="two-fields">
        <label>
          Reason
          <input
            value={refundReason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
        <label>
          Open cash drawer ID (cash ticket sales only)
          <input
            value={drawerId}
            onChange={(event) => onDrawerChange(event.target.value)}
          />
        </label>
      </div>
      <h3>Ticket orders</h3>
      <div className="refund-list">
        {ticketOrders.map((order) => {
          const cashRequired = order.cashTransactions.some(
            (entry) => entry.type === "SALE" && entry.amountCents > 0,
          );
          const needsAttention = ticketNeedsAttention(order);
          return (
            <article
              className={needsAttention ? "refund-attention" : undefined}
              key={order.id}
            >
              <div>
                <strong>
                  {order.orderNumber} · {money(order.totalCents)}
                </strong>
                <span>
                  {order.customer?.name ||
                    order.customer?.email ||
                    order.guestName ||
                    order.guestEmail ||
                    "Walk-up customer"} ·{" "}
                  {order.tickets[0]?.showtimeSeat.showtime.movie.title} ·{" "}
                  {order.tickets
                    .map((ticket) => ticket.showtimeSeat.seat.label)
                    .join(", ")}
                </span>
                {order.customer && (
                  <Link
                    href={`/customers/${encodeURIComponent(order.customer.id)}`}
                  >
                    Open customer
                  </Link>
                )}
                <div className="status-row">
                  <b
                    className={needsAttention ? "status-alert" : "status-chip"}
                  >
                    Order {order.status}
                  </b>
                  <b
                    className={needsAttention ? "status-alert" : "status-chip"}
                  >
                    Payment {order.payment?.status ?? "CASH"}
                  </b>
                  {order.payment?.refunds.map((attempt, index) => (
                    <RefundAttemptBadge
                      attempt={attempt}
                      timeZone={timeZone}
                      key={`${attempt.createdAt}-${index}`}
                    />
                  ))}
                  {order.payment?.verificationFailureNote && (
                    <small>{order.payment.verificationFailureNote}</small>
                  )}
                </div>
              </div>
              <button
                className={needsAttention ? "primary" : "destructive"}
                disabled={refundPending}
                onClick={() => onRefund("ticket", order.id, cashRequired)}
              >
                {needsAttention ? "Retry refund" : "Full refund"}
              </button>
            </article>
          );
        })}
      </div>
      {!ticketOrders.length && (
        <p className="muted">No refundable ticket orders match this search.</p>
      )}
      <h3>Restaurant tabs</h3>
      <div className="refund-list">
        {restaurantTabs.map((tab) => {
          const needsAttention = tabNeedsAttention(tab);
          return (
            <article
              className={needsAttention ? "refund-attention" : undefined}
              key={tab.id}
            >
              <div>
                <strong>
                  {tab.receipt?.receiptNumber ?? tab.label ?? "Restaurant tab"}{" "}
                  · {money(tab.totalCents ?? 0)}
                </strong>
                <span>
                  {tab.primaryCustomer?.name ||
                    tab.primaryCustomer?.email ||
                    "Guest"}{" "}
                  · {tab.showtime?.movie.title ?? "Walk-in"}
                </span>
                {tab.primaryCustomer && (
                  <Link
                    href={`/customers/${encodeURIComponent(tab.primaryCustomer.id)}`}
                  >
                    Open customer
                  </Link>
                )}
                <div className="status-row">
                  <b
                    className={needsAttention ? "status-alert" : "status-chip"}
                  >
                    Tab {tab.status}
                  </b>
                  {tab.payments.map((payment, index) => (
                    <b
                      key={index}
                      className={
                        payment.status === "FAILED"
                          ? "status-alert"
                          : "status-chip"
                      }
                    >
                      Tender {payment.status}
                    </b>
                  ))}
                  {tab.payments
                    .flatMap((payment) => payment.refunds)
                    .map((attempt, index) => (
                      <RefundAttemptBadge
                        attempt={attempt}
                        timeZone={timeZone}
                        key={`${attempt.createdAt}-${index}`}
                      />
                    ))}
                </div>
              </div>
              <button
                className={needsAttention ? "primary" : "destructive"}
                disabled={refundPending}
                onClick={() => onRefund("restaurant", tab.id)}
              >
                {needsAttention ? "Retry refund" : "Full refund"}
              </button>
            </article>
          );
        })}
      </div>
      {!restaurantTabs.length && (
        <p className="muted">
          No refundable restaurant tabs match this search.
        </p>
      )}
      <hr />
      <h3>Completed refund history</h3>
      <form
        className="refund-history-filters"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <label>
          From
          <input
            type="date"
            value={historyFrom}
            onChange={(event) => onHistoryFromChange(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={historyTo}
            onChange={(event) => onHistoryToChange(event.target.value)}
          />
        </label>
        <button className="secondary">Refresh history</button>
      </form>
      <RefundHistoryList history={history} timeZone={timeZone} />
    </section>
  );
}

function RefundHistoryList({ history, timeZone }: { history: Refunds | null; timeZone: string }) {
  if (!history) return null;
  return (
    <div className="refund-list refund-history-list">
      {history.ticketOrders.map((order) => (
        <article key={`ticket-${order.id}`}>
          <div>
            <strong>
              {order.orderNumber} · {money(order.totalCents)}
            </strong>
            <span>
              Ticket order ·{" "}
              {order.customer?.name ||
                order.customer?.email ||
                order.guestName ||
                order.guestEmail ||
                "Walk-up customer"} ·{" "}
              {order.tickets[0]?.showtimeSeat.showtime.movie.title ?? "Film"}
            </span>
            {order.customer && (
              <Link
                href={`/customers/${encodeURIComponent(order.customer.id)}`}
              >
                Open customer
              </Link>
            )}
            <div className="status-row">
              {order.payment?.refunds.map((attempt, index) => (
                <RefundAttemptBadge
                  attempt={attempt}
                  timeZone={timeZone}
                  key={`${attempt.createdAt}-${index}`}
                />
              ))}
              {order.cashTransactions.map((entry, index) => (
                <b className="status-chip" key={index}>
                  Cash refund {money(entry.amountCents)}
                </b>
              ))}
            </div>
          </div>
        </article>
      ))}
      {history.restaurantTabs.map((tab) => (
        <article key={`restaurant-${tab.id}`}>
          <div>
            <strong>
              {tab.receipt?.receiptNumber ?? tab.label ?? "Restaurant tab"} ·{" "}
              {money(tab.totalCents ?? 0)}
            </strong>
            <span>
              Restaurant ·{" "}
              {tab.primaryCustomer?.name ||
                tab.primaryCustomer?.email ||
                "Guest"}{" "}
              · {tab.showtime?.movie.title ?? "Walk-in"}
            </span>
            {tab.primaryCustomer && (
              <Link
                href={`/customers/${encodeURIComponent(tab.primaryCustomer.id)}`}
              >
                Open customer
              </Link>
            )}
            <div className="status-row">
              {tab.payments
                .flatMap((payment) => payment.refunds)
                .map((attempt, index) => (
                  <RefundAttemptBadge
                    attempt={attempt}
                    timeZone={timeZone}
                    key={`${attempt.createdAt}-${index}`}
                  />
                ))}
            </div>
          </div>
        </article>
      ))}
      {!history.ticketOrders.length && !history.restaurantTabs.length && (
        <p className="muted">
          No completed refunds match this search and date range.
        </p>
      )}
    </div>
  );
}

function RefundAttemptBadge({ attempt, timeZone }: { attempt: RefundAttempt; timeZone: string }) {
  const attention = unresolvedRefund(attempt.status);
  const details = [
    money(attempt.amountCents),
    new Date(attempt.createdAt).toLocaleString([], { timeZone }),
    attempt.reason,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <b className={attention ? "status-alert" : "status-chip"} title={details}>
      Refund {attempt.status}
    </b>
  );
}
