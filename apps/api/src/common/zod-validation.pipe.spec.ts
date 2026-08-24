import { z } from "zod/v3";
import { ZodValidationPipe } from "./zod-validation.pipe";
import { AppError } from "./app-error";

describe("ZodValidationPipe", () => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
  const pipe = new ZodValidationPipe(schema);

  it("passes through valid input unchanged", () => {
    const input = { email: "a@b.com", password: "password123" };
    expect(pipe.transform(input)).toEqual(input);
  });

  it("throws an AppError with VALIDATION_FAILED for invalid input", () => {
    expect(() => pipe.transform({ email: "not-an-email", password: "short" })).toThrow(AppError);
  });

  it("reports each failing field in the error details", () => {
    try {
      pipe.transform({ email: "not-an-email", password: "short" });
      fail("expected transform to throw");
    } catch (err) {
      const appError = err as AppError;
      const details = appError.details as { issues: Array<{ path: string }> };
      const paths = details.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
    }
  });
});
