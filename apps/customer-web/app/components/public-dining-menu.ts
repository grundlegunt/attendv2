"use client";

import { useEffect, useState } from "react";
import type { PublicDiningMenuResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";

export function usePublicDiningMenu() {
  const [menu, setMenu] = useState<PublicDiningMenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setError(null);

    apiFetch<PublicDiningMenuResponse>("/cinema/menu")
      .then(setMenu)
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "The menu is unavailable."));
  }, [loadAttempt]);

  return { menu, error, retry: () => setLoadAttempt((attempt) => attempt + 1) };
}
