import { ConsoleLogger, Injectable, Scope } from "@nestjs/common";

/**
 * Structured JSON logger. Per ARCHITECTURE.md §8 / AGENTS.md: every log
 * line is a single JSON object so it's machine-parseable in any log
 * aggregator, and callers can attach request id / actor / location context.
 * Never log secrets, passwords, tokens, or payment credentials — see
 * SECURITY.md §1/§6.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLogger extends ConsoleLogger {
  private structuredContext: Record<string, unknown> = {};

  withContext(context: Record<string, unknown>): this {
    this.structuredContext = { ...this.structuredContext, ...context };
    return this;
  }

  private write(level: string, message: unknown, extra?: Record<string, unknown>) {
    const line = {
      level,
      time: new Date().toISOString(),
      message,
      ...this.structuredContext,
      ...extra,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  }

  override log(message: unknown, ...optionalParams: unknown[]) {
    this.write("info", message, this.extractContext(optionalParams));
  }

  override warn(message: unknown, ...optionalParams: unknown[]) {
    this.write("warn", message, this.extractContext(optionalParams));
  }

  override error(message: unknown, ...optionalParams: unknown[]) {
    this.write("error", message, this.extractContext(optionalParams));
  }

  override debug(message: unknown, ...optionalParams: unknown[]) {
    if (process.env.NODE_ENV === "production") return;
    this.write("debug", message, this.extractContext(optionalParams));
  }

  private extractContext(optionalParams: unknown[]): Record<string, unknown> | undefined {
    if (optionalParams.length === 0) return undefined;
    return { params: optionalParams };
  }
}
