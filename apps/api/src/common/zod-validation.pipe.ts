import { PipeTransform } from "@nestjs/common";
import { ZodSchema } from "zod/v3";
import { AppError } from "./app-error";

/**
 * Validates a request body against a zod schema (shared with frontends via
 * @cinema/shared, per AGENTS.md §8/DATA_MODEL.md). Rejects malformed or
 * unexpected input before it reaches any business logic — see
 * SECURITY.md §10.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validationFailed("Request validation failed.", {
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return result.data;
  }
}
