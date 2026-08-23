import { createHash } from "node:crypto";

export type RedactedErrorAlert = {
  source?: string;
  environment: string;
  errorName: string;
  fingerprint: string;
  frames: string[];
  method: string;
  path: string;
  requestId?: string;
  occurredAt: string;
};

export function redactedErrorDetails(exception: unknown) {
  const errorName = exception instanceof Error ? exception.name || "Error" : "UnknownError";
  const stack = exception instanceof Error ? exception.stack ?? errorName : errorName;
  return {
    errorName,
    fingerprint: createHash("sha256").update(stack).digest("hex").slice(0, 24),
    // The first stack line contains the exception message and may include customer data.
    // Stack frames retain actionable code locations without forwarding that message.
    frames: stack.split("\n").slice(1, 9).map((frame) => frame.trim()),
  };
}

export class ErrorAlertReporter {
  constructor(private readonly webhookUrl?: string) {}

  report(alert: RedactedErrorAlert): void {
    if (!this.webhookUrl) return;
    void fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
  }
}
