"use client";

import { useEffect } from "react";
import { reportClientError } from "@cinema/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void reportClientError("kds", error, API_BASE_URL).catch(() => undefined); }, [error]);
  return <html><body><main style={{ maxWidth: 720, margin: "15vh auto", padding: 32, fontFamily: "system-ui" }}><h1>Kitchen display encountered an error</h1><p>A private error reference was recorded without order, payment, or login details.</p><button onClick={reset}>Try again</button></main></body></html>;
}
