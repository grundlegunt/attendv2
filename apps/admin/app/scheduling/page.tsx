"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  movieArtworkObjectPosition,
  showtimeWindowsOverlap,
  type AuditoriumSeatingMode,
  type MovieArtworkPosition,
  type SeatMapLayout,
} from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import {
  SchedulingCalendar,
  type CalendarShowtime,
} from "../scheduling-calendar";
import {
  applyShowtimeMoves,
  captureShowtimeMoves,
  type ShowtimeMoveSnapshot,
} from "../schedule-undo";
import { useAdminSession, useAdminUi } from "../admin-session";

interface Auditorium {
  id: string;
  name: string;
  capacity: number;
  seatingMode: AuditoriumSeatingMode;
  seatMap: {
    id: string;
    name: string;
    version: number;
    layoutJson: SeatMapLayout | null;
    seats: Array<
      SeatMapSeat & {
        rowLabel: string;
        number: number;
        levelKey?: string | null;
        sectionKey?: string | null;
      }
    >;
  } | null;
}
function auditoriumCapacityLabel(auditorium: Auditorium) {
  return `${auditorium.capacity} ${auditorium.seatingMode === "GENERAL_ADMISSION" ? "admissions" : "seats"}`;
}
interface Movie {
  id: string;
  updatedAt: string;
  title: string;
  runtimeMinutes: number;
  synopsis?: string | null;
  rating?: string | null;
  posterUrl?: string | null;
  detailPosterUrl?: string | null;
  posterPosition?: MovieArtworkPosition;
  detailPosterPosition?: MovieArtworkPosition;
  diningSpecialArtworkUrl?: string | null;
  diningSpecialTitle?: string | null;
  director?: string | null;
  starring?: string | null;
  trailerUrl?: string | null;
  releaseYear?: number | null;
  distributorName?: string | null;
  distributorTerms?: Array<{
    startWeek: number;
    endWeek: number | null;
    distributorShareBasisPoints: number;
  }> | null;
  pairings?: Array<{ menuItemId: string; sortOrder: number }>;
}
interface PriceTier {
  id: string;
  name: string;
  ticketPriceMinor: number;
  feeMinor: number;
  currency: string;
}
interface FilmSeries {
  id: string;
  name: string;
  description?: string | null;
  artworkUrl?: string | null;
  active: boolean;
}
interface Showtime {
  id: string;
  updatedAt: string;
  startsAt: string;
  featureStartsAt: string;
  endsAt: string;
  roomReadyAt: string;
  onSale: boolean;
  filmSeries: FilmSeries | null;
  presentation: "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
  format?: string | null;
  movie: Movie;
  auditorium: Auditorium;
  priceTier: PriceTier;
}
interface ShowtimeSeatInventory {
  seats: Array<
    Omit<SeatMapSeat, "state"> & {
      state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";
    }
  >;
  counts: { available: number; held: number; sold: number; blocked: number };
}
interface Bootstrap {
  location: {
    id: string;
    name: string;
    preShowBufferMinutes: number;
    cleaningBufferMinutes: number;
    auditoriums: Auditorium[];
    organization: {
      movies: Movie[];
      priceTiers: PriceTier[];
      filmSeries: FilmSeries[];
    };
    menuCategories: Array<{
      id: string;
      name: string;
      items: Array<{ id: string; name: string; imageUrl?: string | null }>;
    }>;
  };
  showtimes: Showtime[];
  archivedMovies: Movie[];
}
interface SchedulePlan {
  id: string;
  name: string;
  weekStartsAt: string;
  createdAt: string;
  snapshotJson: SchedulePlanShowtime[];
}
interface SchedulePlanShowtime {
  movieId: string;
  auditoriumId: string;
  priceTierId: string | null;
  startsAt: string;
  onSale: boolean;
  filmSeriesId: string | null;
  presentation: Showtime["presentation"];
  format: string | null;
}
interface SchedulePlanValidation {
  valid: boolean;
  showtimeCount: number;
  issues: Array<{ index: number; message: string }>;
  expectedUpdatedAt: string;
}

function dateTimeInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentWeekStart() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export default function AdminPage() {
  const { employee, accessToken: token, supportSession } = useAdminSession();
  const adminUi = useAdminUi();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState("");
  const [runtime, setRuntime] = useState(120);
  const [movieSynopsis, setMovieSynopsis] = useState("");
  const [movieRating, setMovieRating] = useState("");
  const [moviePosterUrl, setMoviePosterUrl] = useState("");
  const [movieDetailPosterUrl, setMovieDetailPosterUrl] = useState("");
  const [moviePosterPosition, setMoviePosterPosition] =
    useState<MovieArtworkPosition>("CENTER");
  const [movieDetailPosterPosition, setMovieDetailPosterPosition] =
    useState<MovieArtworkPosition>("CENTER");
  const [movieDiningSpecialArtworkUrl, setMovieDiningSpecialArtworkUrl] =
    useState("");
  const [movieDiningSpecialTitle, setMovieDiningSpecialTitle] = useState("");
  const [movieDirector, setMovieDirector] = useState("");
  const [movieStarring, setMovieStarring] = useState("");
  const [movieTrailerUrl, setMovieTrailerUrl] = useState("");
  const [movieReleaseYear, setMovieReleaseYear] = useState<number | "">("");
  const [movieDistributorName, setMovieDistributorName] = useState("");
  const [movieDistributorTerms, setMovieDistributorTerms] = useState<
    Array<{
      startWeek: number;
      endWeek: number | null;
      distributorShareBasisPoints: number;
    }>
  >([]);
  const [pairingMenuItemIds, setPairingMenuItemIds] = useState<string[]>([]);
  const [pairingMenuSearch, setPairingMenuSearch] = useState("");
  const [editingMovieId, setEditingMovieId] = useState<string | null>(null);
  const [editingMovieUpdatedAt, setEditingMovieUpdatedAt] = useState<string | null>(null);
  const [movieId, setMovieId] = useState("");
  const [auditoriumId, setAuditoriumId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [onSale, setOnSale] = useState(true);
  const [priceTierId, setPriceTierId] = useState("");
  const [filmSeriesId, setFilmSeriesId] = useState("");
  const [presentation, setPresentation] = useState<
    "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST"
  >("STANDARD");
  const [showtimeFormat, setShowtimeFormat] = useState("");
  const [editingShowtimeId, setEditingShowtimeId] = useState<string | null>(
    null,
  );
  const [editingShowtimeUpdatedAt, setEditingShowtimeUpdatedAt] = useState<string | null>(null);
  const showtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updateShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const saleStatusAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const quickShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const duplicateDayAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const removeShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const moveShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const groupMoveAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const undoMoveAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [showtimeEditorOpen, setShowtimeEditorOpen] = useState(false);
  const [linkedShowtimeHandled, setLinkedShowtimeHandled] = useState(false);
  const [movieEditorOpen, setMovieEditorOpen] = useState(false);
  const movieAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updateMovieAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const archiveMovieAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const restoreMovieAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deleteMovieAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [seatInventory, setSeatInventory] =
    useState<ShowtimeSeatInventory | null>(null);
  const [seatInventoryError, setSeatInventoryError] = useState<string | null>(
    null,
  );
  const [undoMoves, setUndoMoves] = useState<ShowtimeMoveSnapshot[] | null>(
    null,
  );
  const [undoingMove, setUndoingMove] = useState(false);
  const [schedulePlans, setSchedulePlans] = useState<SchedulePlan[]>([]);
  const [planName, setPlanName] = useState("");
  const [planWeek, setPlanWeek] = useState(currentWeekStart);
  const [savingPlan, setSavingPlan] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [managingPlan, setManagingPlan] = useState<{ id: string; action: "duplicate" | "rename" } | null>(null);
  const [planShowtimeMutation, setPlanShowtimeMutation] = useState<{ index: number | null; action: "add" | "change" | "remove" } | null>(null);
  const savingPlanRef = useRef(false);
  const deletingPlanRef = useRef(false);
  const managingPlanRef = useRef(false);
  const planShowtimeMutationRef = useRef(false);
  const schedulePlanAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const duplicatePlanAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const addPlanShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const removePlanShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const updatePlanShowtimeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const renamePlanAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const deletePlanAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const publishPlanAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planShowtimeMovieId, setPlanShowtimeMovieId] = useState("");
  const [planShowtimeAuditoriumId, setPlanShowtimeAuditoriumId] = useState("");
  const [planShowtimePriceTierId, setPlanShowtimePriceTierId] = useState("");
  const [planShowtimeStartsAt, setPlanShowtimeStartsAt] = useState("");
  const [planShowtimePresentation, setPlanShowtimePresentation] =
    useState<Showtime["presentation"]>("STANDARD");
  const [planValidation, setPlanValidation] =
    useState<SchedulePlanValidation | null>(null);
  const [validatingPlan, setValidatingPlan] = useState(false);
  const [publishingPlan, setPublishingPlan] = useState(false);
  const planActionPendingRef = useRef(false);

  async function refresh(accessToken = token) {
    if (!accessToken) return;
    const [response, plans] = await Promise.all([
      apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }),
      apiFetch<SchedulePlan[]>("/cinema/schedule-plans", { accessToken }),
    ]);
    setData(response);
    setSchedulePlans(plans);
    setMovieId(
      (current) =>
        current || response.location.organization.movies[0]?.id || "",
    );
    setAuditoriumId(
      (current) => current || response.location.auditoriums[0]?.id || "",
    );
  }

  useEffect(() => {
    refresh().catch(showError);
  }, [token]);
  function showError(reason: unknown) {
    setError(
      reason instanceof ApiRequestError
        ? reason.body.message
        : "The request could not be completed.",
    );
  }

  async function saveSchedulePlan(event: FormEvent) {
    event.preventDefault();
    if (savingPlanRef.current || deletingPlanRef.current || managingPlanRef.current || planShowtimeMutationRef.current) return;
    savingPlanRef.current = true;
    setError(null);
    setSavingPlan(true);
    const body = JSON.stringify({
      name: planName.trim(),
      weekStartsAt: new Date(`${planWeek}T00:00:00`).toISOString(),
    });
    if (schedulePlanAttemptRef.current?.fingerprint !== body) {
      schedulePlanAttemptRef.current = {
        fingerprint: body,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch("/cinema/schedule-plans", {
        accessToken: token ?? undefined,
        method: "POST",
        headers: { "Idempotency-Key": schedulePlanAttemptRef.current.requestId },
        body,
      });
      schedulePlanAttemptRef.current = null;
      setPlanName("");
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        schedulePlanAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      savingPlanRef.current = false;
      setSavingPlan(false);
    }
  }

  async function deleteSchedulePlan(plan: SchedulePlan) {
    if (savingPlanRef.current || deletingPlanRef.current || managingPlanRef.current || planShowtimeMutationRef.current) return;
    if (
      !window.confirm(
        `Delete the saved schedule plan “${plan.name}”? The live schedule will not change.`,
      )
    )
      return;
    deletingPlanRef.current = true;
    setDeletingPlanId(plan.id);
    setError(null);
    const fingerprint = plan.id;
    if (deletePlanAttemptRef.current?.fingerprint !== fingerprint) {
      deletePlanAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/schedule-plans/${plan.id}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
        headers: {
          "Idempotency-Key": deletePlanAttemptRef.current!.requestId,
        },
      });
      deletePlanAttemptRef.current = null;
      setSchedulePlans((current) =>
        current.filter((candidate) => candidate.id !== plan.id),
      );
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        deletePlanAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      deletingPlanRef.current = false;
      setDeletingPlanId(null);
    }
  }

  async function duplicateSchedulePlan(plan: SchedulePlan) {
    if (savingPlanRef.current || deletingPlanRef.current || managingPlanRef.current || planShowtimeMutationRef.current) return;
    const name = window
      .prompt("Name the new schedule plan:", `${plan.name} copy`)
      ?.trim();
    if (!name) return;
    managingPlanRef.current = true;
    setManagingPlan({ id: plan.id, action: "duplicate" });
    setError(null);
    const body = JSON.stringify({ name });
    const fingerprint = `${plan.id}:${body}`;
    if (duplicatePlanAttemptRef.current?.fingerprint !== fingerprint) {
      duplicatePlanAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const duplicate = await apiFetch<SchedulePlan>(
        `/cinema/schedule-plans/${plan.id}/duplicate`,
        {
          accessToken: token ?? undefined,
          method: "POST",
          headers: { "Idempotency-Key": duplicatePlanAttemptRef.current.requestId },
          body,
        },
      );
      duplicatePlanAttemptRef.current = null;
      setSchedulePlans((current) => [duplicate, ...current]);
      setSelectedPlanId(duplicate.id);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        duplicatePlanAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      managingPlanRef.current = false;
      setManagingPlan(null);
    }
  }

  async function renameSchedulePlan(plan: SchedulePlan) {
    if (savingPlanRef.current || deletingPlanRef.current || managingPlanRef.current || planShowtimeMutationRef.current) return;
    const name = window.prompt("Rename this schedule plan:", plan.name)?.trim();
    if (!name || name === plan.name) return;
    managingPlanRef.current = true;
    setManagingPlan({ id: plan.id, action: "rename" });
    setError(null);
    const body = JSON.stringify({ name, expectedName: plan.name });
    const fingerprint = `${plan.id}:${body}`;
    if (renamePlanAttemptRef.current?.fingerprint !== fingerprint) {
      renamePlanAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const updated = await apiFetch<SchedulePlan>(
        `/cinema/schedule-plans/${plan.id}`,
        {
          accessToken: token ?? undefined,
          method: "PATCH",
          headers: {
            "Idempotency-Key": renamePlanAttemptRef.current!.requestId,
          },
          body,
        },
      );
      renamePlanAttemptRef.current = null;
      setSchedulePlans((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        renamePlanAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      managingPlanRef.current = false;
      setManagingPlan(null);
    }
  }

  async function removeSchedulePlanShowtime(
    plan: SchedulePlan,
    index: number,
    title: string,
  ) {
    if (planShowtimeMutationRef.current || planActionPendingRef.current) return;
    if (
      !window.confirm(
        `Remove ${title} from “${plan.name}”? The live showing will not be changed.`,
      )
    )
      return;
    planShowtimeMutationRef.current = true;
    setPlanShowtimeMutation({ index, action: "remove" });
    setError(null);
    const fingerprint = `${plan.id}:${index}`;
    if (removePlanShowtimeAttemptRef.current?.fingerprint !== fingerprint) {
      removePlanShowtimeAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const updated = await apiFetch<SchedulePlan>(
        `/cinema/schedule-plans/${plan.id}/showtimes/${index}`,
        {
          accessToken: token ?? undefined,
          method: "DELETE",
          headers: {
            "Idempotency-Key": removePlanShowtimeAttemptRef.current!.requestId,
          },
        },
      );
      removePlanShowtimeAttemptRef.current = null;
      setSchedulePlans((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        removePlanShowtimeAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      planShowtimeMutationRef.current = false;
      setPlanShowtimeMutation(null);
    }
  }

  async function changeSchedulePlanShowtime(
    plan: SchedulePlan,
    index: number,
    showtime: SchedulePlanShowtime,
    title: string,
  ) {
    if (planShowtimeMutationRef.current || planActionPendingRef.current) return;
    const value = window
      .prompt(
        `Change the saved time for ${title}:`,
        dateTimeInputValue(new Date(showtime.startsAt)),
      )
      ?.trim();
    if (!value) return;
    const startsAt = new Date(value);
    if (Number.isNaN(startsAt.getTime())) {
      setError("Enter a valid date and time.");
      return;
    }
    planShowtimeMutationRef.current = true;
    setPlanShowtimeMutation({ index, action: "change" });
    setError(null);
    const body = JSON.stringify({
      startsAt: startsAt.toISOString(),
      expectedStartsAt: showtime.startsAt,
    });
    const fingerprint = `${plan.id}:${index}:${body}`;
    if (updatePlanShowtimeAttemptRef.current?.fingerprint !== fingerprint) {
      updatePlanShowtimeAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const updated = await apiFetch<SchedulePlan>(
        `/cinema/schedule-plans/${plan.id}/showtimes/${index}`,
        {
          accessToken: token ?? undefined,
          method: "PATCH",
          headers: {
            "Idempotency-Key": updatePlanShowtimeAttemptRef.current!.requestId,
          },
          body,
        },
      );
      updatePlanShowtimeAttemptRef.current = null;
      setSchedulePlans((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        updatePlanShowtimeAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      planShowtimeMutationRef.current = false;
      setPlanShowtimeMutation(null);
    }
  }

  async function addSchedulePlanShowtime(event: FormEvent, plan: SchedulePlan) {
    event.preventDefault();
    if (!data || !planShowtimeStartsAt) return;
    if (planShowtimeMutationRef.current || planActionPendingRef.current) return;
    planShowtimeMutationRef.current = true;
    setPlanShowtimeMutation({ index: null, action: "add" });
    setError(null);
    const body = JSON.stringify({
      movieId: planShowtimeMovieId || data.location.organization.movies[0]?.id,
      auditoriumId:
        planShowtimeAuditoriumId || data.location.auditoriums[0]?.id,
      priceTierId:
        planShowtimePriceTierId || data.location.organization.priceTiers[0]?.id,
      startsAt: new Date(planShowtimeStartsAt).toISOString(),
      onSale: false,
      presentation: planShowtimePresentation,
      filmSeriesId: null,
      format: null,
    });
    const fingerprint = `${plan.id}:${body}`;
    if (addPlanShowtimeAttemptRef.current?.fingerprint !== fingerprint) {
      addPlanShowtimeAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const updated = await apiFetch<SchedulePlan>(
        `/cinema/schedule-plans/${plan.id}/showtimes`,
        {
          accessToken: token ?? undefined,
          method: "POST",
          headers: {
            "Idempotency-Key": addPlanShowtimeAttemptRef.current.requestId,
          },
          body,
        },
      );
      addPlanShowtimeAttemptRef.current = null;
      setSchedulePlans((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      setPlanShowtimeStartsAt("");
      setPlanShowtimePresentation("STANDARD");
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        addPlanShowtimeAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      planShowtimeMutationRef.current = false;
      setPlanShowtimeMutation(null);
    }
  }

  async function validateSchedulePlan(plan: SchedulePlan) {
    if (planActionPendingRef.current || planShowtimeMutationRef.current) return;
    planActionPendingRef.current = true;
    setError(null);
    setPlanValidation(null);
    setValidatingPlan(true);
    try {
      const validation = await apiFetch<SchedulePlanValidation>(
        `/cinema/schedule-plans/${plan.id}/validate`,
        {
          accessToken: token ?? undefined,
          method: "POST",
        },
      );
      setPlanValidation(validation);
    } catch (reason) {
      showError(reason);
    } finally {
      planActionPendingRef.current = false;
      setValidatingPlan(false);
    }
  }

  async function makeSchedulePlanLive(plan: SchedulePlan) {
    if (planActionPendingRef.current || planShowtimeMutationRef.current) return;
    planActionPendingRef.current = true;
    setError(null);
    setPlanValidation(null);
    setValidatingPlan(true);
    let validation: SchedulePlanValidation;
    try {
      validation = await apiFetch<SchedulePlanValidation>(
        `/cinema/schedule-plans/${plan.id}/validate`,
        {
          accessToken: token ?? undefined,
          method: "POST",
        },
      );
      setPlanValidation(validation);
    } catch (reason) {
      showError(reason);
      planActionPendingRef.current = false;
      return;
    } finally {
      setValidatingPlan(false);
    }
    if (!validation.valid) {
      planActionPendingRef.current = false;
      return;
    }
    if (
      !window.confirm(
        `Publish “${plan.name}” as the live schedule? This replaces the future live week only when no protected sales or restaurant records would be affected.`,
      )
    ) {
      planActionPendingRef.current = false;
      return;
    }
    setPublishingPlan(true);
    const body = JSON.stringify({
      expectedUpdatedAt: validation.expectedUpdatedAt,
    });
    const fingerprint = `${plan.id}:${body}`;
    if (publishPlanAttemptRef.current?.fingerprint !== fingerprint) {
      publishPlanAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const result = await apiFetch<{
        published: boolean;
        preservedCount: number;
        createdCount: number;
        removedCount: number;
      }>(`/cinema/schedule-plans/${plan.id}/publish`, {
        accessToken: token ?? undefined,
        method: "POST",
        headers: {
          "Idempotency-Key": publishPlanAttemptRef.current!.requestId,
        },
        body,
      });
      publishPlanAttemptRef.current = null;
      await refresh();
      setPlanValidation(null);
      window.alert(
        `Schedule published. ${result.preservedCount} preserved, ${result.createdCount} added, ${result.removedCount} replaced.`,
      );
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        publishPlanAttemptRef.current = null;
      }
      showError(reason);
    } finally {
      planActionPendingRef.current = false;
      setPublishingPlan(false);
    }
  }

  const linkedMovieId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("movieId");
  const linkedShowtimeId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("showtimeId");
  const selectedPlan =
    schedulePlans.find((plan) => plan.id === selectedPlanId) ?? null;
  useEffect(() => {
    setPlanValidation(null);
  }, [selectedPlanId, selectedPlan?.snapshotJson]);
  const selectedPlanRows = useMemo(() => {
    if (!selectedPlan || !data) return [];
    const rows = selectedPlan.snapshotJson.map((showtime) => ({
      ...showtime,
      movie: data.location.organization.movies.find(
        (movie) => movie.id === showtime.movieId,
      ),
      auditorium: data.location.auditoriums.find(
        (auditorium) => auditorium.id === showtime.auditoriumId,
      ),
      matchesLive: data.showtimes.some(
        (live) =>
          live.movie.id === showtime.movieId &&
          live.auditorium.id === showtime.auditoriumId &&
          live.startsAt === showtime.startsAt &&
          live.onSale === showtime.onSale,
      ),
    }));
    return rows.map((row, index) => {
      const startsAt = new Date(row.startsAt);
      const roomReadyAt = new Date(
        startsAt.getTime() +
          (data.location.preShowBufferMinutes +
            (row.movie?.runtimeMinutes ?? 90) +
            Math.max(15, data.location.cleaningBufferMinutes)) *
            60_000,
      );
      const hasConflict = rows.some((candidate, candidateIndex) => {
        if (
          candidateIndex === index ||
          candidate.auditoriumId !== row.auditoriumId
        )
          return false;
        const candidateStartsAt = new Date(candidate.startsAt);
        const candidateRoomReadyAt = new Date(
          candidateStartsAt.getTime() +
            (data.location.preShowBufferMinutes +
              (candidate.movie?.runtimeMinutes ?? 90) +
              Math.max(15, data.location.cleaningBufferMinutes)) *
              60_000,
        );
        return showtimeWindowsOverlap(
          { startsAt, roomReadyAt },
          { startsAt: candidateStartsAt, roomReadyAt: candidateRoomReadyAt },
        );
      });
      return { ...row, hasConflict };
    });
  }, [data, selectedPlan]);

  async function createMovie(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const body = JSON.stringify({
      title: movieTitle,
      runtimeMinutes: runtime,
      synopsis: movieSynopsis.trim() || null,
      rating: movieRating.trim() || null,
      posterUrl: moviePosterUrl.trim() || null,
      detailPosterUrl: movieDetailPosterUrl.trim() || null,
      posterPosition: moviePosterPosition,
      detailPosterPosition: movieDetailPosterPosition,
      diningSpecialArtworkUrl: movieDiningSpecialArtworkUrl.trim() || null,
      diningSpecialTitle: movieDiningSpecialTitle.trim() || null,
      director: movieDirector.trim() || null,
      starring: movieStarring.trim() || null,
      trailerUrl: movieTrailerUrl.trim() || null,
      releaseYear: movieReleaseYear === "" ? null : movieReleaseYear,
      distributorName: movieDistributorName.trim() || null,
      distributorTerms: movieDistributorTerms,
      pairingMenuItemIds,
    });
    if (!editingMovieId && movieAttemptRef.current?.fingerprint !== body) {
      movieAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    }
    const updateFingerprint = `${editingMovieId}:${editingMovieUpdatedAt}:${body}`;
    if (editingMovieId && updateMovieAttemptRef.current?.fingerprint !== updateFingerprint) {
      updateMovieAttemptRef.current = {
        fingerprint: updateFingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(
        editingMovieId ? `/cinema/movies/${editingMovieId}` : "/cinema/movies",
        {
          accessToken: token ?? undefined,
          method: editingMovieId ? "PATCH" : "POST",
          body,
          ...(!editingMovieId && movieAttemptRef.current
            ? { headers: { "Idempotency-Key": movieAttemptRef.current.requestId } }
            : editingMovieId && updateMovieAttemptRef.current
              ? {
                  headers: {
                    "Idempotency-Key": updateMovieAttemptRef.current.requestId,
                    ...(editingMovieUpdatedAt
                      ? { "If-Unmodified-Since": editingMovieUpdatedAt }
                      : {}),
                  },
                }
              : {}),
        },
      );
      movieAttemptRef.current = null;
      updateMovieAttemptRef.current = null;
      setMovieTitle("");
      setMovieSynopsis("");
      setMovieRating("");
      setMoviePosterUrl("");
      setMovieDetailPosterUrl("");
      setMoviePosterPosition("CENTER");
      setMovieDetailPosterPosition("CENTER");
      setMovieDiningSpecialArtworkUrl("");
      setMovieDiningSpecialTitle("");
      setMovieDirector("");
      setMovieStarring("");
      setMovieTrailerUrl("");
      setMovieReleaseYear("");
      setPairingMenuItemIds([]);
      setMovieDistributorName("");
      setMovieDistributorTerms([]);
      setPairingMenuSearch("");
      setEditingMovieId(null);
      setEditingMovieUpdatedAt(null);
      setMovieEditorOpen(false);
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        movieAttemptRef.current = null;
        updateMovieAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function archiveMovie(movie: Movie) {
    if (
      !window.confirm(
        `Remove ${movie.title} (${movie.runtimeMinutes} min) from the film library? Existing showtime and sales history will be preserved.`,
      )
    )
      return;
    setError(null);
    if (archiveMovieAttemptRef.current?.fingerprint !== movie.id) {
      archiveMovieAttemptRef.current = {
        fingerprint: movie.id,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/movies/${movie.id}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
        headers: {
          "Idempotency-Key": archiveMovieAttemptRef.current.requestId,
        },
      });
      archiveMovieAttemptRef.current = null;
      if (movieId === movie.id) setMovieId("");
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        archiveMovieAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function restoreMovie(movie: Movie) {
    setError(null);
    if (restoreMovieAttemptRef.current?.fingerprint !== movie.id) {
      restoreMovieAttemptRef.current = {
        fingerprint: movie.id,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/movies/${movie.id}/restore`, {
        accessToken: token ?? undefined,
        method: "POST",
        headers: {
          "Idempotency-Key": restoreMovieAttemptRef.current.requestId,
        },
      });
      restoreMovieAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        restoreMovieAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function permanentlyDeleteMovie(movie: Movie) {
    if (
      !window.confirm(
        `Permanently delete ${movie.title}? This cannot be undone.`,
      )
    )
      return;
    setError(null);
    if (deleteMovieAttemptRef.current?.fingerprint !== movie.id) {
      deleteMovieAttemptRef.current = {
        fingerprint: movie.id,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/movies/${movie.id}/permanent`, {
        accessToken: token ?? undefined,
        method: "DELETE",
        headers: {
          "Idempotency-Key": deleteMovieAttemptRef.current.requestId,
        },
      });
      deleteMovieAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        deleteMovieAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function duplicateDay(
    sourceDate: string,
    targetDates: string[],
    saleStatus: "PRESERVE" | "DRAFT" | "ON_SALE",
  ) {
    setError(null);
    const body = JSON.stringify({ sourceDate, targetDates, saleStatus });
    if (duplicateDayAttemptRef.current?.fingerprint !== body) {
      duplicateDayAttemptRef.current = {
        fingerprint: body,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch<{ createdCount: number }>("/cinema/showtimes/duplicate-day", {
        accessToken: token ?? undefined,
        method: "POST",
        headers: { "Idempotency-Key": duplicateDayAttemptRef.current.requestId },
        body,
      });
      duplicateDayAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        duplicateDayAttemptRef.current = null;
      }
      throw reason;
    }
  }

  async function createShowtime(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const body = JSON.stringify({
      movieId,
      auditoriumId,
      priceTierId: priceTierId || undefined,
      startsAt: new Date(startsAt).toISOString(),
      onSale,
      filmSeriesId: filmSeriesId || null,
      presentation,
      format: showtimeFormat.trim() || null,
    });
    if (!editingShowtimeId && showtimeAttemptRef.current?.fingerprint !== body) showtimeAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    const updateFingerprint = editingShowtimeId
      ? `${editingShowtimeId}:${editingShowtimeUpdatedAt}:${body}`
      : null;
    if (
      updateFingerprint &&
      updateShowtimeAttemptRef.current?.fingerprint !== updateFingerprint
    ) {
      updateShowtimeAttemptRef.current = {
        fingerprint: updateFingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(
        editingShowtimeId
          ? `/cinema/showtimes/${editingShowtimeId}`
          : "/cinema/showtimes",
        {
          accessToken: token ?? undefined,
          method: editingShowtimeId ? "PATCH" : "POST",
          headers: editingShowtimeId
            ? {
                "Idempotency-Key": updateShowtimeAttemptRef.current!.requestId,
                ...(editingShowtimeUpdatedAt
                  ? { "If-Unmodified-Since": editingShowtimeUpdatedAt }
                  : {}),
              }
            : { "Idempotency-Key": showtimeAttemptRef.current!.requestId },
          body,
        },
      );
      if (editingShowtimeId) updateShowtimeAttemptRef.current = null;
      else showtimeAttemptRef.current = null;
      setEditingShowtimeId(null);
      setEditingShowtimeUpdatedAt(null);
      setShowtimeEditorOpen(false);
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        if (editingShowtimeId) updateShowtimeAttemptRef.current = null;
        else showtimeAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  function editShowtime(showtime: CalendarShowtime) {
    const local = new Date(showtime.startsAt);
    setEditingShowtimeId(showtime.id);
    setEditingShowtimeUpdatedAt(showtime.updatedAt);
    setMovieId(showtime.movie.id);
    setAuditoriumId(showtime.auditorium.id);
    setStartsAt(dateTimeInputValue(local));
    setOnSale(showtime.onSale);
    setPriceTierId(showtime.priceTier.id);
    setFilmSeriesId(showtime.filmSeries?.id ?? "");
    setPresentation(showtime.presentation ?? "STANDARD");
    setShowtimeFormat(showtime.format ?? "");
    setShowtimeEditorOpen(true);
  }

  useEffect(() => {
    if (!showtimeEditorOpen || !editingShowtimeId) {
      setSeatInventory(null);
      setSeatInventoryError(null);
      return;
    }
    let canceled = false;
    setSeatInventory(null);
    setSeatInventoryError(null);
    apiFetch<ShowtimeSeatInventory>(
      `/cinema/showtimes/${editingShowtimeId}/seats`,
    )
      .then((inventory) => {
        if (!canceled) setSeatInventory(inventory);
      })
      .catch(() => {
        if (!canceled)
          setSeatInventoryError("Seat inventory could not be loaded.");
      });
    return () => {
      canceled = true;
    };
  }, [editingShowtimeId, showtimeEditorOpen]);

  useEffect(() => {
    if (!data || !linkedShowtimeId || linkedShowtimeHandled) return;
    const showtime = data.showtimes.find(
      (candidate) => candidate.id === linkedShowtimeId,
    );
    if (showtime) editShowtime(showtime);
    setLinkedShowtimeHandled(true);
  }, [data, linkedShowtimeHandled, linkedShowtimeId]);

  function createShowtimeAt(
    auditorium: string,
    date: Date,
    selectedMovieId?: string,
  ) {
    if (!data) return;
    if (supportSession) {
      setError(
        "Attend Support view is read only. Sign in as a cinema manager to add a showing.",
      );
      return;
    }
    if (!data.location.organization.movies.length) {
      setError(
        "Add an active film to the film library before scheduling a showing.",
      );
      return;
    }
    const selectedAuditorium = data.location.auditoriums.find(
      (room) => room.id === auditorium,
    );
    if (!selectedAuditorium?.capacity) {
      setError(
        "This auditorium needs an active seat layout before it can be scheduled.",
      );
      return;
    }
    if (!data.location.organization.priceTiers.length) {
      setError(
        "Add an admission price under Reports & Finance before scheduling a showing.",
      );
      return;
    }
    const local = new Date(date);
    setEditingShowtimeId(null);
    setMovieId(selectedMovieId ?? "");
    setAuditoriumId(auditorium);
    setStartsAt(dateTimeInputValue(local));
    setOnSale(true);
    setPriceTierId("");
    setFilmSeriesId("");
    setPresentation("STANDARD");
    setShowtimeFormat("");
    setShowtimeEditorOpen(true);
  }

  async function quickCreateShowtime(
    auditorium: string,
    date: Date,
    selectedMovieId: string,
  ) {
    setError(null);
    const body = JSON.stringify({
      movieId: selectedMovieId,
      auditoriumId: auditorium,
      startsAt: date.toISOString(),
      onSale: true,
      presentation: "STANDARD",
    });
    if (quickShowtimeAttemptRef.current?.fingerprint !== body) quickShowtimeAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/cinema/showtimes", {
        accessToken: token ?? undefined,
        method: "POST",
        headers: { "Idempotency-Key": quickShowtimeAttemptRef.current.requestId },
        body,
      });
      quickShowtimeAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) quickShowtimeAttemptRef.current = null;
      showError(reason);
    }
  }

  function shiftShowtime(minutes: number) {
    if (!startsAt) return;
    const next = new Date(startsAt);
    next.setMinutes(next.getMinutes() + minutes);
    setStartsAt(dateTimeInputValue(next));
  }

  async function changeSaleStatus() {
    if (!editingShowtimeId) return;
    setError(null);
    const nextOnSale = !onSale;
    const fingerprint = `${editingShowtimeId}:${editingShowtimeUpdatedAt}:${nextOnSale}`;
    if (saleStatusAttemptRef.current?.fingerprint !== fingerprint) {
      saleStatusAttemptRef.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const updated = await apiFetch<CalendarShowtime>(
        `/cinema/showtimes/${editingShowtimeId}`,
        {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({ onSale: nextOnSale }),
          headers: {
            "Idempotency-Key": saleStatusAttemptRef.current.requestId,
            ...(editingShowtimeUpdatedAt
              ? { "If-Unmodified-Since": editingShowtimeUpdatedAt }
              : {}),
          },
        },
      );
      saleStatusAttemptRef.current = null;
      setOnSale(nextOnSale);
      setEditingShowtimeUpdatedAt(updated.updatedAt);
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        saleStatusAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function removeShowtime() {
    if (!editingShowtimeId) return;
    const label = selectedMovie?.title ?? "this showtime";
    if (
      !window.confirm(
        `Remove ${label} from the schedule? This is only allowed for a future showing with no ticket, hold, or restaurant activity.`,
      )
    )
      return;
    setError(null);
    if (removeShowtimeAttemptRef.current?.fingerprint !== editingShowtimeId) {
      removeShowtimeAttemptRef.current = {
        fingerprint: editingShowtimeId,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/showtimes/${editingShowtimeId}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
        headers: {
          "Idempotency-Key": removeShowtimeAttemptRef.current!.requestId,
        },
      });
      removeShowtimeAttemptRef.current = null;
      setEditingShowtimeId(null);
      setShowtimeEditorOpen(false);
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        removeShowtimeAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  async function quickRemoveShowtime(showtime: CalendarShowtime) {
    if (
      !window.confirm(
        `Remove ${showtime.movie.title} from the schedule? This is only allowed for a future showing with no ticket, hold, or restaurant activity.`,
      )
    )
      return;
    setError(null);
    if (removeShowtimeAttemptRef.current?.fingerprint !== showtime.id) {
      removeShowtimeAttemptRef.current = {
        fingerprint: showtime.id,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      await apiFetch(`/cinema/showtimes/${showtime.id}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
        headers: {
          "Idempotency-Key": removeShowtimeAttemptRef.current!.requestId,
        },
      });
      removeShowtimeAttemptRef.current = null;
      if (editingShowtimeId === showtime.id) {
        setEditingShowtimeId(null);
        setShowtimeEditorOpen(false);
      }
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        removeShowtimeAttemptRef.current = null;
      }
      showError(reason);
    }
  }

  const selectedMovie = data?.location.organization.movies.find(
    (movie) => movie.id === movieId,
  );
  const selectedRoom = data?.location.auditoriums.find(
    (room) => room.id === auditoriumId,
  );
  const diningSpecialPreviewTitle =
    movieDiningSpecialTitle.trim() ||
    data?.location.menuCategories
      .flatMap((category) => category.items)
      .filter((item) => pairingMenuItemIds.includes(item.id))
      .map((item) => item.name)
      .join(" & ") ||
    "Dining special headline";
  const selectedTiming = useMemo(() => {
    if (!startsAt || !selectedMovie || !data) return null;
    const doors = new Date(startsAt);
    const feature = new Date(
      doors.getTime() + data.location.preShowBufferMinutes * 60000,
    );
    const ends = new Date(
      feature.getTime() + selectedMovie.runtimeMinutes * 60000,
    );
    const ready = new Date(
      ends.getTime() +
        Math.max(15, data.location.cleaningBufferMinutes) * 60000,
    );
    return { doors, feature, ends, ready };
  }, [data, selectedMovie, startsAt]);

  function displayTime(value: Date) {
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function applyLocalMoves(moves: ShowtimeMoveSnapshot[]) {
    setData((current) =>
      current
        ? {
            ...current,
            showtimes: applyShowtimeMoves(
              current.showtimes,
              current.location.auditoriums,
              moves,
            ),
          }
        : current,
    );
  }

  async function moveShowtime(
    showtime: CalendarShowtime,
    nextAuditoriumId: string,
    nextStartsAt: Date,
  ) {
    setError(null);
    const rollback = captureShowtimeMoves([showtime]);
    const move = [
      {
        showtimeId: showtime.id,
        auditoriumId: nextAuditoriumId,
        startsAt: nextStartsAt.toISOString(),
      },
    ];
    const fingerprint = JSON.stringify(move[0]);
    if (moveShowtimeAttemptRef.current?.fingerprint !== fingerprint) {
      moveShowtimeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    applyLocalMoves(move);
    try {
      await apiFetch(`/cinema/showtimes/${showtime.id}`, {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({
          movieId: showtime.movie.id,
          auditoriumId: nextAuditoriumId,
          startsAt: nextStartsAt.toISOString(),
          onSale: showtime.onSale,
        }),
        headers: {
          "Idempotency-Key": moveShowtimeAttemptRef.current.requestId,
        },
      });
      moveShowtimeAttemptRef.current = null;
      setUndoMoves(rollback);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        moveShowtimeAttemptRef.current = null;
      }
      applyLocalMoves(rollback);
      showError(reason);
    }
  }

  async function moveManyShowtimes(
    moves: Array<{
      showtime: CalendarShowtime;
      auditoriumId: string;
      startsAt: Date;
    }>,
  ) {
    setError(null);
    const rollback = captureShowtimeMoves(
      moves.map(({ showtime }) => showtime),
    );
    const requestedMoves = moves.map(
      ({ showtime, auditoriumId, startsAt }) => ({
        showtimeId: showtime.id,
        auditoriumId,
        startsAt: startsAt.toISOString(),
      }),
    );
    const fingerprint = JSON.stringify(requestedMoves);
    if (groupMoveAttemptRef.current?.fingerprint !== fingerprint) {
      groupMoveAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    applyLocalMoves(requestedMoves);
    try {
      await apiFetch("/cinema/showtimes/group", {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({ moves: requestedMoves }),
        headers: {
          "Idempotency-Key": groupMoveAttemptRef.current.requestId,
        },
      });
      groupMoveAttemptRef.current = null;
      setUndoMoves(rollback);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        groupMoveAttemptRef.current = null;
      }
      applyLocalMoves(rollback);
      showError(reason);
    }
  }

  async function undoLastMove() {
    if (!undoMoves?.length || undoingMove) return;
    setError(null);
    setUndoingMove(true);
    const rollback = captureShowtimeMoves(
      (data?.showtimes ?? []).filter((showtime) =>
        undoMoves.some((move) => move.showtimeId === showtime.id),
      ),
    );
    const fingerprint = JSON.stringify(undoMoves);
    if (undoMoveAttemptRef.current?.fingerprint !== fingerprint) {
      undoMoveAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    applyLocalMoves(undoMoves);
    try {
      if (undoMoves.length === 1) {
        const move = undoMoves[0]!;
        await apiFetch(`/cinema/showtimes/${move.showtimeId}`, {
          accessToken: token ?? undefined,
          method: "PATCH",
          body: JSON.stringify({
            auditoriumId: move.auditoriumId,
            startsAt: move.startsAt,
          }),
          headers: {
            "Idempotency-Key": undoMoveAttemptRef.current.requestId,
          },
        });
      } else {
        await apiFetch("/cinema/showtimes/group", {
          accessToken: token ?? undefined,
          method: "PATCH",
          body: JSON.stringify({ moves: undoMoves }),
          headers: {
            "Idempotency-Key": undoMoveAttemptRef.current.requestId,
          },
        });
      }
      undoMoveAttemptRef.current = null;
      setUndoMoves(null);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        undoMoveAttemptRef.current = null;
      }
      applyLocalMoves(rollback);
      showError(reason);
    } finally {
      setUndoingMove(false);
    }
  }

  function openMovieEditor(movie?: Movie) {
    setEditingMovieId(movie?.id ?? null);
    setEditingMovieUpdatedAt(movie?.updatedAt ?? null);
    setMovieTitle(movie?.title ?? "");
    setRuntime(movie?.runtimeMinutes ?? 120);
    setMovieSynopsis(movie?.synopsis ?? "");
    setMovieRating(movie?.rating ?? "");
    setMoviePosterUrl(movie?.posterUrl ?? "");
    setMovieDetailPosterUrl(movie?.detailPosterUrl ?? "");
    setMoviePosterPosition(movie?.posterPosition ?? "CENTER");
    setMovieDetailPosterPosition(movie?.detailPosterPosition ?? "CENTER");
    setMovieDiningSpecialArtworkUrl(movie?.diningSpecialArtworkUrl ?? "");
    setMovieDiningSpecialTitle(movie?.diningSpecialTitle ?? "");
    setMovieDirector(movie?.director ?? "");
    setMovieStarring(movie?.starring ?? "");
    setMovieTrailerUrl(movie?.trailerUrl ?? "");
    setMovieReleaseYear(movie?.releaseYear ?? "");
    setMovieDistributorName(movie?.distributorName ?? "");
    setMovieDistributorTerms(
      Array.isArray(movie?.distributorTerms) ? movie.distributorTerms : [],
    );
    setPairingMenuItemIds(
      movie?.pairings?.map((pairing) => pairing.menuItemId) ?? [],
    );
    setPairingMenuSearch("");
    setMovieEditorOpen(true);
  }

  return (
    <main className="admin-shell">
      <header>
        <div>
          <p className="kicker">ATTEND · CINEMA CONFIG</p>
          <h1>{data?.location.name ?? "Loading…"}</h1>
        </div>
        <span>{employee.name}</span>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <section className="stats">
        <div>
          <strong>{data?.location.auditoriums.length ?? 0}</strong>
          <span>Auditoriums</span>
        </div>
        <div>
          <strong>{data?.location.organization.movies.length ?? 0}</strong>
          <span>Movies</span>
        </div>
        <div>
          <strong>{data?.showtimes.length ?? 0}</strong>
          <span>Showtimes</span>
        </div>
        <div>
          <strong>30 + 15</strong>
          <span>Pre-show + cleaning</span>
        </div>
      </section>

      <section
        className="schedule-plan-panel"
        aria-labelledby="schedule-plans-heading"
      >
        <div className="schedule-plan-heading">
          <div>
            <p className="kicker">SCHEDULE PLANS</p>
            <h2 id="schedule-plans-heading">Save a weekly version</h2>
            <p>
              Capture an alternate plan without changing the live customer
              schedule.
            </p>
          </div>
          <form onSubmit={saveSchedulePlan}>
            <label>
              Plan name
              <input
                required
                maxLength={80}
                value={planName}
                disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}
                onChange={(event) => setPlanName(event.target.value)}
                placeholder="Opening week · Plan A"
              />
            </label>
            <label>
              Week of
              <input
                required
                type="date"
                value={planWeek}
                disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}
                onChange={(event) => setPlanWeek(event.target.value)}
              />
            </label>
            <button className="primary" disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}>
              {savingPlan ? "Saving…" : "Save current week"}
            </button>
          </form>
        </div>
        {schedulePlans.length > 0 ? (
          <div className="schedule-plan-list">
            {schedulePlans.map((plan) => (
              <article key={plan.id}>
                <div>
                  <strong>{plan.name}</strong>
                  <span>
                    Week of{" "}
                    {new Date(plan.weekStartsAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                </div>
                <span>
                  {Array.isArray(plan.snapshotJson)
                    ? plan.snapshotJson.length
                    : 0}{" "}
                  showtimes saved
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setSelectedPlanId((current) =>
                      current === plan.id ? null : plan.id,
                    )
                  }
                >
                  {selectedPlanId === plan.id ? "Close preview" : "Preview"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}
                  onClick={() => void duplicateSchedulePlan(plan)}
                >
                  {managingPlan?.id === plan.id && managingPlan.action === "duplicate" ? "Duplicating…" : "Duplicate"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}
                  onClick={() => void renameSchedulePlan(plan)}
                >
                  {managingPlan?.id === plan.id && managingPlan.action === "rename" ? "Renaming…" : "Rename"}
                </button>
                <button
                  type="button"
                  className="secondary destructive-outline"
                  disabled={savingPlan || deletingPlanId !== null || managingPlan !== null}
                  onClick={() => void deleteSchedulePlan(plan)}
                >
                  {deletingPlanId === plan.id ? "Deleting…" : "Delete"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="schedule-plan-empty">
            No alternate schedule plans saved yet.
          </p>
        )}
        {selectedPlan && (
          <section
            className="schedule-plan-preview"
            aria-label={`${selectedPlan.name} preview`}
          >
            <div className="schedule-plan-preview-heading">
              <div>
                <p className="kicker">SAVED PLAN PREVIEW</p>
                <h3>{selectedPlan.name}</h3>
              </div>
              <div className="schedule-plan-preview-status">
                <span>
                  {selectedPlanRows.filter((row) => row.matchesLive).length} of{" "}
                  {selectedPlanRows.length} match live
                </span>
                {selectedPlanRows.some((row) => row.hasConflict) && (
                  <strong>
                    {selectedPlanRows.filter((row) => row.hasConflict).length}{" "}
                    conflicting showtimes
                  </strong>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={validatingPlan || publishingPlan || planShowtimeMutation !== null}
                  onClick={() => void validateSchedulePlan(selectedPlan)}
                >
                  {validatingPlan ? "Checking…" : "Check plan"}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={validatingPlan || publishingPlan || planShowtimeMutation !== null}
                  onClick={() => void makeSchedulePlanLive(selectedPlan)}
                >
                  {publishingPlan
                    ? "Publishing…"
                    : validatingPlan
                      ? "Checking…"
                      : "Make live"}
                </button>
              </div>
            </div>
            <p className="schedule-plan-preview-note">
              Editing this saved copy cannot change ticket availability until
              you choose Make live. Publishing replaces only this plan's future
              week and stops if a showing has sales, active holds, or restaurant
              activity.
            </p>
            {planValidation && (
              <div
                className={
                  planValidation.valid
                    ? "plan-validation-success"
                    : "plan-validation-error"
                }
              >
                {planValidation.valid ? (
                  <span>{`Ready to make live: all ${planValidation.showtimeCount} saved showtimes passed the server safety check.`}</span>
                ) : (
                  <>
                    <strong>This plan is not ready to publish.</strong>
                    <ul>
                      {planValidation.issues.map((issue, index) => (
                        <li key={`${issue.index}-${index}`}>
                          Showing {issue.index + 1}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {data && (
              <form
                className="schedule-plan-add"
                onSubmit={(event) =>
                  void addSchedulePlanShowtime(event, selectedPlan)
                }
              >
                <label>
                  Film
                  <select
                    required
                    value={
                      planShowtimeMovieId ||
                      data.location.organization.movies[0]?.id ||
                      ""
                    }
                    onChange={(event) =>
                      setPlanShowtimeMovieId(event.target.value)
                    }
                  >
                    {data.location.organization.movies.map((movie) => (
                      <option key={movie.id} value={movie.id}>
                        {movie.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Auditorium
                  <select
                    required
                    value={
                      planShowtimeAuditoriumId ||
                      data.location.auditoriums[0]?.id ||
                      ""
                    }
                    onChange={(event) =>
                      setPlanShowtimeAuditoriumId(event.target.value)
                    }
                  >
                    {data.location.auditoriums.map((auditorium) => (
                      <option key={auditorium.id} value={auditorium.id}>
                        {auditorium.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ticket tier
                  <select
                    required
                    value={
                      planShowtimePriceTierId ||
                      data.location.organization.priceTiers[0]?.id ||
                      ""
                    }
                    onChange={(event) =>
                      setPlanShowtimePriceTierId(event.target.value)
                    }
                  >
                    {data.location.organization.priceTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date & time
                  <input
                    required
                    type="datetime-local"
                    value={planShowtimeStartsAt}
                    onChange={(event) =>
                      setPlanShowtimeStartsAt(event.target.value)
                    }
                  />
                </label>
                <label>
                  Presentation
                  <select
                    value={planShowtimePresentation}
                    onChange={(event) =>
                      setPlanShowtimePresentation(
                        event.target.value as Showtime["presentation"],
                      )
                    }
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="OPEN_CAPTIONS">Open captions</option>
                    <option value="Q_AND_A">Q&amp;A</option>
                    <option value="SPECIAL_GUEST">Special guest</option>
                  </select>
                </label>
                <button className="secondary" disabled={planShowtimeMutation !== null || validatingPlan || publishingPlan}>
                  {planShowtimeMutation?.action === "add" ? "Adding…" : "Add to saved plan"}
                </button>
              </form>
            )}
            {selectedPlanRows.length > 0 ? (
              <div className="schedule-plan-preview-list">
                {selectedPlanRows.map((showtime, index) => (
                  <article
                    key={`${showtime.startsAt}-${showtime.auditoriumId}-${index}`}
                  >
                    <time dateTime={showtime.startsAt}>
                      {new Date(showtime.startsAt).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                    <div>
                      <strong>
                        {showtime.movie?.title ?? "Unavailable film"}
                      </strong>
                      <span>
                        {showtime.auditorium?.name ?? "Unavailable auditorium"}{" "}
                        ·{" "}
                        {showtime.presentation
                          .replaceAll("_", " ")
                          .toLocaleLowerCase()}
                      </span>
                    </div>
                    <span
                      className={
                        showtime.hasConflict
                          ? "plan-conflict"
                          : showtime.matchesLive
                            ? "plan-match"
                            : "plan-difference"
                      }
                    >
                      {showtime.hasConflict
                        ? "Schedule conflict"
                        : showtime.matchesLive
                          ? "Matches live"
                          : "Different from live"}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={planShowtimeMutation !== null || validatingPlan || publishingPlan}
                      onClick={() =>
                        void changeSchedulePlanShowtime(
                          selectedPlan,
                          index,
                          showtime,
                          showtime.movie?.title ?? "this showing",
                        )
                      }
                    >
                      {planShowtimeMutation?.index === index && planShowtimeMutation.action === "change" ? "Changing…" : "Change time"}
                    </button>
                    <button
                      type="button"
                      className="secondary destructive-outline"
                      disabled={planShowtimeMutation !== null || validatingPlan || publishingPlan}
                      onClick={() =>
                        void removeSchedulePlanShowtime(
                          selectedPlan,
                          index,
                          showtime.movie?.title ?? "this showing",
                        )
                      }
                    >
                      {planShowtimeMutation?.index === index && planShowtimeMutation.action === "remove" ? "Removing…" : "Remove"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="schedule-plan-empty">
                This saved plan contains no showtimes.
              </p>
            )}
          </section>
        )}
      </section>

      {data && (
        <div
          className={`schedule-with-inspector ${showtimeEditorOpen ? "inspector-open" : ""}`}
        >
          <SchedulingCalendar
            labels={adminUi.labels}
            locationName={data.location.name}
            auditoriums={data.location.auditoriums}
            movies={data.location.organization.movies}
            archivedMovies={data.archivedMovies}
            initialSelectedMovieId={linkedMovieId}
            showtimes={data.showtimes}
            preShowBufferMinutes={data.location.preShowBufferMinutes}
            cleaningBufferMinutes={Math.max(
              15,
              data.location.cleaningBufferMinutes,
            )}
            onCreate={createShowtimeAt}
            onQuickCreate={quickCreateShowtime}
            onEdit={editShowtime}
            onRemoveShowtime={quickRemoveShowtime}
            onMove={moveShowtime}
            onMoveMany={moveManyShowtimes}
            canUndoMove={Boolean(undoMoves?.length)}
            undoingMove={undoingMove}
            onUndoMove={undoLastMove}
            onAddMovie={() => openMovieEditor()}
            onEditMovie={openMovieEditor}
            onArchiveMovie={archiveMovie}
            onRestoreMovie={restoreMovie}
            onDeleteMovie={permanentlyDeleteMovie}
            onDuplicateDay={duplicateDay}
          />

          {showtimeEditorOpen && (
            <aside
              className="schedule-inspector"
              aria-label="Selected showtime"
            >
              <form id="showtime-editor" onSubmit={createShowtime}>
                <div className="drawer-heading">
                  <div>
                    <p className="kicker">SELECTED SHOWTIME</p>
                    <h2>
                      {selectedMovie?.title ??
                        (editingShowtimeId ? "Edit showing" : "Add showing")}
                    </h2>
                    {selectedRoom && (
                      <p className="inspector-room">
                        {selectedRoom.name} ·{" "}
                        {auditoriumCapacityLabel(selectedRoom)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="drawer-close"
                    onClick={() => setShowtimeEditorOpen(false)}
                    aria-label="Close showtime editor"
                  >
                    ×
                  </button>
                </div>
                <div className="showtime-inspector-summary">
                  {selectedTiming && (
                    <div className="timing-summary">
                      <div>
                        <span>Doors / listed time</span>
                        <strong>{displayTime(selectedTiming.doors)}</strong>
                      </div>
                      <div>
                        <span>Feature starts</span>
                        <strong>{displayTime(selectedTiming.feature)}</strong>
                      </div>
                      <div>
                        <span>Film ends</span>
                        <strong>{displayTime(selectedTiming.ends)}</strong>
                      </div>
                      <div>
                        <span>Room ready</span>
                        <strong>{displayTime(selectedTiming.ready)}</strong>
                      </div>
                    </div>
                  )}
                  {selectedMovie && (
                    <div className="selected-film-details">
                      {selectedMovie.posterUrl ? (
                        <img
                          src={selectedMovie.posterUrl}
                          alt={`${selectedMovie.title} poster`}
                        />
                      ) : (
                        <div className="poster-placeholder">No poster</div>
                      )}
                      <div>
                        <strong>{selectedMovie.title}</strong>
                        <span>
                          {selectedMovie.rating || "Not rated"} ·{" "}
                          {selectedMovie.runtimeMinutes} min
                        </span>
                        <button
                          type="button"
                          className="film-details-button"
                          onClick={() => openMovieEditor(selectedMovie)}
                        >
                          Edit film details &amp; poster URL
                        </button>
                      </div>
                    </div>
                  )}
                  {editingShowtimeId && (
                    <section
                      className="showtime-seat-inventory"
                      aria-label="Showtime seat inventory"
                    >
                      <div className="showtime-seat-inventory-heading">
                        <strong>Seat inventory</strong>
                        {seatInventory && (
                          <span>
                            {seatInventory.counts.sold}/
                            {seatInventory.seats.length} sold
                          </span>
                        )}
                      </div>
                      {seatInventory ? (
                        <>
                          <div className="seat-inventory-counts">
                            <span>
                              <b>{seatInventory.counts.available}</b> available
                            </span>
                            <span>
                              <b>{seatInventory.counts.sold}</b> sold
                            </span>
                            <span>
                              <b>{seatInventory.counts.held}</b> held
                            </span>
                            <span>
                              <b>{seatInventory.counts.blocked}</b> blocked
                            </span>
                          </div>
                          <SeatMap
                            seats={seatInventory.seats.map((seat) => ({
                              ...seat,
                              state:
                                seat.state === "AVAILABLE"
                                  ? "available"
                                  : "unavailable",
                            }))}
                            label="Read-only showtime seat inventory"
                          />
                          <p className="sold-seat-labels">
                            <strong>Purchased seats</strong>
                            <span>
                              {seatInventory.seats
                                .filter((seat) => seat.state === "SOLD")
                                .map((seat) => seat.label)
                                .join(", ") || "None"}
                            </span>
                          </p>
                        </>
                      ) : seatInventoryError ? (
                        <p className="inline-error">{seatInventoryError}</p>
                      ) : (
                        <p className="seat-inventory-loading">
                          Loading seat inventory…
                        </p>
                      )}
                    </section>
                  )}
                </div>
                <div className="showtime-inspector-fields">
                  <label>
                    Movie
                    <select
                      required
                      value={movieId}
                      onChange={(e) => setMovieId(e.target.value)}
                    >
                      <option value="">Select</option>
                      {data.location.organization.movies.map((movie) => (
                        <option key={movie.id} value={movie.id}>
                          {movie.title} · {movie.runtimeMinutes}m
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Move to room
                    <select
                      required
                      value={auditoriumId}
                      onChange={(e) => setAuditoriumId(e.target.value)}
                    >
                      <option value="">Select</option>
                      {data.location.auditoriums.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name} · {auditoriumCapacityLabel(room)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="showtime-time-editor">
                    <label>
                      Doors / advertised time
                      <input
                        type="datetime-local"
                        required
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                      />
                    </label>
                    <div className="time-nudges" aria-label="Adjust showtime">
                      <button type="button" onClick={() => shiftShowtime(-15)}>
                        −15
                      </button>
                      <button type="button" onClick={() => shiftShowtime(-5)}>
                        −5
                      </button>
                      <button type="button" onClick={() => shiftShowtime(5)}>
                        +5
                      </button>
                      <button type="button" onClick={() => shiftShowtime(15)}>
                        +15
                      </button>
                    </div>
                  </div>
                  <label>
                    Sale status
                    <select
                      value={onSale ? "open" : "draft"}
                      onChange={(event) =>
                        setOnSale(event.target.value === "open")
                      }
                    >
                      <option value="open">Open for sale</option>
                      <option value="draft">Closed draft</option>
                    </select>
                  </label>
                  <label>
                    Ticket group
                    <select
                      value={priceTierId}
                      onChange={(event) => setPriceTierId(event.target.value)}
                    >
                      <option value="">Automatic for show date</option>
                      {data.location.organization.priceTiers.map((tier) => (
                        <option key={tier.id} value={tier.id}>
                          {tier.name} ·{" "}
                          {new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: tier.currency,
                          }).format(tier.ticketPriceMinor / 100)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Film series
                    <select
                      value={filmSeriesId}
                      onChange={(event) => setFilmSeriesId(event.target.value)}
                    >
                      <option value="">Regular engagement</option>
                      {data.location.organization.filmSeries
                        .filter((series) => series.active)
                        .map((series) => (
                          <option key={series.id} value={series.id}>
                            {series.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Presentation
                    <select
                      value={presentation}
                      onChange={(event) =>
                        setPresentation(
                          event.target.value as typeof presentation,
                        )
                      }
                    >
                      <option value="STANDARD">Standard</option>
                      <option value="OPEN_CAPTIONS">Open captions</option>
                      <option value="Q_AND_A">Q&amp;A</option>
                      <option value="SPECIAL_GUEST">Special guest</option>
                    </select>
                  </label>
                  <label>
                    Screening format
                    <input
                      value={showtimeFormat}
                      onChange={(event) =>
                        setShowtimeFormat(event.target.value)
                      }
                      placeholder="DCP, 35mm, 70mm…"
                    />
                  </label>
                </div>
                <div className="calculation-note">
                  Attend includes {data.location.preShowBufferMinutes} minutes
                  of pre-show, the film runtime, and at least 15 minutes of
                  cleaning. Conflicting placements are rejected.
                </div>
                <div className="showtime-inspector-actions">
                  <button className="primary">
                    {editingShowtimeId ? "Save changes" : "Add to schedule"}
                  </button>
                  {editingShowtimeId && (
                    <button
                      type="button"
                      className={
                        onSale
                          ? "sale-action close-sale"
                          : "sale-action open-sale"
                      }
                      onClick={() => void changeSaleStatus()}
                    >
                      {onSale ? "Close sales" : "Open sales"}
                    </button>
                  )}
                  {editingShowtimeId && (
                    <button
                      type="button"
                      className="secondary destructive-outline"
                      onClick={() => void removeShowtime()}
                    >
                      Remove from schedule
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowtimeEditorOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </form>
            </aside>
          )}
        </div>
      )}

      {movieEditorOpen && (
        <div
          className="editor-backdrop"
          role="presentation"
          onMouseDown={() => setMovieEditorOpen(false)}
        >
          <form
            className="showtime-drawer"
            onSubmit={createMovie}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <p className="kicker">FILM LIBRARY</p>
                <h2>{editingMovieId ? "Edit film" : "Add a film"}</h2>
              </div>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setMovieEditorOpen(false)}
                aria-label="Close film editor"
              >
                ×
              </button>
            </div>
            <label>
              Title
              <input
                required
                autoFocus
                value={movieTitle}
                onChange={(event) => setMovieTitle(event.target.value)}
              />
            </label>
            <label>
              Runtime in minutes
              <input
                type="number"
                min="1"
                max="600"
                value={runtime}
                onChange={(event) => setRuntime(Number(event.target.value))}
              />
            </label>
            <label>
              Rating
              <input
                value={movieRating}
                onChange={(event) => setMovieRating(event.target.value)}
                placeholder="PG, PG-13, R…"
              />
            </label>
            <label>
              Showtimes artwork URL
              <input
                type="text"
                value={moviePosterUrl}
                onChange={(event) => setMoviePosterUrl(event.target.value)}
                placeholder="Landscape image used on film cards"
              />
            </label>
            <label>
              Showtimes artwork framing
              <select
                value={moviePosterPosition}
                onChange={(event) =>
                  setMoviePosterPosition(
                    event.target.value as MovieArtworkPosition,
                  )
                }
              >
                <option value="TOP_LEFT">Top left</option>
                <option value="TOP">Top center</option>
                <option value="TOP_RIGHT">Top right</option>
                <option value="CENTER_LEFT">Center left</option>
                <option value="CENTER">Center</option>
                <option value="CENTER_RIGHT">Center right</option>
                <option value="BOTTOM_LEFT">Bottom left</option>
                <option value="BOTTOM">Bottom center</option>
                <option value="BOTTOM_RIGHT">Bottom right</option>
              </select>
            </label>
            <label>
              Movie detail poster URL
              <input
                type="text"
                value={movieDetailPosterUrl}
                onChange={(event) =>
                  setMovieDetailPosterUrl(event.target.value)
                }
                placeholder="Vertical one-sheet used on the film page"
              />
            </label>
            <label>
              Detail poster framing
              <select
                value={movieDetailPosterPosition}
                onChange={(event) =>
                  setMovieDetailPosterPosition(
                    event.target.value as MovieArtworkPosition,
                  )
                }
              >
                <option value="TOP_LEFT">Top left</option>
                <option value="TOP">Top center</option>
                <option value="TOP_RIGHT">Top right</option>
                <option value="CENTER_LEFT">Center left</option>
                <option value="CENTER">Center</option>
                <option value="CENTER_RIGHT">Center right</option>
                <option value="BOTTOM_LEFT">Bottom left</option>
                <option value="BOTTOM">Bottom center</option>
                <option value="BOTTOM_RIGHT">Bottom right</option>
              </select>
            </label>
            <label>
              Dining special artwork URL
              <input
                type="text"
                value={movieDiningSpecialArtworkUrl}
                onChange={(event) =>
                  setMovieDiningSpecialArtworkUrl(event.target.value)
                }
                placeholder="Single photo showing the paired food and drink"
              />
            </label>
            <label>
              Dining special headline
              <input
                maxLength={120}
                value={movieDiningSpecialTitle}
                onChange={(event) =>
                  setMovieDiningSpecialTitle(event.target.value)
                }
                placeholder="Optional short promotional name shown over the photo"
              />
            </label>
            {(moviePosterUrl ||
              movieDetailPosterUrl ||
              movieDiningSpecialArtworkUrl) && (
              <div
                className="movie-artwork-previews"
                aria-label="Film artwork previews"
              >
                {moviePosterUrl && (
                  <figure>
                    <img
                      src={moviePosterUrl}
                      alt=""
                      style={{
                        objectPosition:
                          movieArtworkObjectPosition(moviePosterPosition),
                      }}
                    />
                    <figcaption>Showtimes card</figcaption>
                  </figure>
                )}
                {movieDetailPosterUrl && (
                  <figure className="movie-artwork-preview--poster">
                    <img
                      src={movieDetailPosterUrl}
                      alt=""
                      style={{
                        objectPosition: movieArtworkObjectPosition(
                          movieDetailPosterPosition,
                        ),
                      }}
                    />
                    <figcaption>Movie detail poster</figcaption>
                  </figure>
                )}
                {movieDiningSpecialArtworkUrl && (
                  <figure>
                    <div className="movie-special-card-preview">
                      <img src={movieDiningSpecialArtworkUrl} alt="" />
                      <div>
                        <strong>{diningSpecialPreviewTitle}</strong>
                        <span>{movieTitle || "Movie title"}</span>
                      </div>
                    </div>
                    <figcaption>
                      Dining special · combined food &amp; drink
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
            <label>
              Director
              <input
                value={movieDirector}
                onChange={(event) => setMovieDirector(event.target.value)}
              />
            </label>
            <label>
              Starring
              <input
                value={movieStarring}
                onChange={(event) => setMovieStarring(event.target.value)}
                placeholder="Comma-separated cast"
              />
            </label>
            <label>
              Trailer URL
              <input
                type="url"
                value={movieTrailerUrl}
                onChange={(event) => setMovieTrailerUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Release year
              <input
                type="number"
                min="1888"
                max="2200"
                value={movieReleaseYear}
                onChange={(event) =>
                  setMovieReleaseYear(
                    event.target.value ? Number(event.target.value) : "",
                  )
                }
              />
            </label>
            <fieldset className="pairing-picker">
              <legend>Distributor deal</legend>
              <label>
                Distributor
                <input
                  value={movieDistributorName}
                  onChange={(event) =>
                    setMovieDistributorName(event.target.value)
                  }
                  placeholder="Distributor or booking contact"
                />
              </label>
              <p>
                Record the distributor's percentage of box-office revenue by
                engagement week.
              </p>
              {movieDistributorTerms.map((term, index) => (
                <div
                  className="pairing-picker__controls"
                  key={`${index}-${term.startWeek}`}
                >
                  <label>
                    From week
                    <input
                      type="number"
                      min="1"
                      max="520"
                      value={term.startWeek}
                      onChange={(event) =>
                        setMovieDistributorTerms((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  startWeek: Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Through week
                    <input
                      type="number"
                      min="1"
                      max="520"
                      value={term.endWeek ?? ""}
                      placeholder="Ongoing"
                      onChange={(event) =>
                        setMovieDistributorTerms((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  endWeek: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Distributor share %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={term.distributorShareBasisPoints / 100}
                      onChange={(event) =>
                        setMovieDistributorTerms((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  distributorShareBasisPoints: Math.round(
                                    Number(event.target.value) * 100,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setMovieDistributorTerms((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setMovieDistributorTerms((current) => [
                    ...current,
                    {
                      startWeek:
                        (current.at(-1)?.endWeek ??
                          current.at(-1)?.startWeek ??
                          0) + 1,
                      endWeek: null,
                      distributorShareBasisPoints: 5000,
                    },
                  ])
                }
              >
                + Add deal period
              </button>
            </fieldset>
            <label>
              Synopsis
              <textarea
                rows={6}
                value={movieSynopsis}
                onChange={(event) => setMovieSynopsis(event.target.value)}
                placeholder="Short customer-facing film description"
              />
            </label>
            <fieldset className="pairing-picker">
              <legend>Paired food &amp; drink</legend>
              <div className="pairing-picker__heading">
                <p>Choose the menu items featured with this film.</p>
                <span>{pairingMenuItemIds.length} selected</span>
              </div>
              <div className="pairing-picker__controls">
                <input
                  type="search"
                  value={pairingMenuSearch}
                  onChange={(event) => setPairingMenuSearch(event.target.value)}
                  placeholder="Search food, drinks, or categories"
                  aria-label="Search paired menu items"
                />
                {pairingMenuItemIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPairingMenuItemIds([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="pairing-picker__grid">
                {data?.location.menuCategories.flatMap((category) =>
                  category.items
                    .filter((item) =>
                      `${item.name} ${category.name}`
                        .toLocaleLowerCase()
                        .includes(pairingMenuSearch.trim().toLocaleLowerCase()),
                    )
                    .map((item) => {
                      const selected = pairingMenuItemIds.includes(item.id);
                      return (
                        <label
                          className="pairing-option"
                          data-selected={selected || undefined}
                          key={item.id}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) =>
                              setPairingMenuItemIds((current) =>
                                event.target.checked
                                  ? [...current, item.id]
                                  : current.filter((id) => id !== item.id),
                              )
                            }
                          />
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <span
                              className="pairing-option__placeholder"
                              aria-hidden="true"
                            >
                              {item.name.slice(0, 1)}
                            </span>
                          )}
                          <span className="pairing-option__copy">
                            <strong>{item.name}</strong>
                            <small>{category.name}</small>
                          </span>
                          <span
                            className="pairing-option__check"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                        </label>
                      );
                    }),
                )}
              </div>
            </fieldset>
            <button className="primary">
              {editingMovieId ? "Save film" : "Add to film library"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setMovieEditorOpen(false)}
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
