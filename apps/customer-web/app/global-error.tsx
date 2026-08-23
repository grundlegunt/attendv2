"use client";

import { useEffect } from "react";
import { reportClientError } from "@cinema/shared";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void reportClientError("customer-web", error, "/api/v1").catch(() => undefined); }, [error]);
  return <html><body><main style={{ maxWidth: 720, margin: "15vh auto", padding: 32, fontFamily: "system-ui" }}><h1>Something went wrong</h1><p>We recorded a private error reference. No payment or account details were included.</p><button onClick={reset}>Try again</button></main></body></html>;
}
