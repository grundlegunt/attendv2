import {
  CinemaService,
  privateEventPreferredDate,
  schedulePlanWeekWindow,
} from "./cinema.service";

describe("private-event preferred dates", () => {
  it("resolves calendar dates inside the cinema-local day across DST", () => {
    const preferred = privateEventPreferredDate("2026-03-08", "America/Chicago");
    expect(preferred.toISOString()).toBe("2026-03-08T17:30:00.000Z");
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(preferred).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    expect(`${parts.year}-${parts.month}-${parts.day}`).toBe("2026-03-08");
  });

  it("keeps legacy timestamp submissions compatible", () => {
    expect(privateEventPreferredDate("2026-09-12T12:00:00.000Z", "America/Chicago").toISOString()).toBe("2026-09-12T12:00:00.000Z");
  });
});

describe("schedule-plan week windows", () => {
  it("uses seven cinema calendar days across spring daylight saving", () => {
    const window = schedulePlanWeekWindow(
      new Date("2026-03-02T00:00:00.000Z"),
      "America/Chicago",
    );
    expect(window.startsAt.toISOString()).toBe("2026-03-02T06:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(window.endsAt.getTime() - window.startsAt.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it("uses seven cinema calendar days across fall daylight saving", () => {
    const window = schedulePlanWeekWindow(
      new Date("2026-10-26T00:00:00.000Z"),
      "America/Chicago",
    );
    expect(window.startsAt.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(window.endsAt.getTime() - window.startsAt.getTime()).toBe(169 * 60 * 60 * 1000);
  });
});

describe("CinemaService seat-hold expiry", () => {
  it("does not overlap expiry sweeps", async () => {
    const service = new CinemaService();
    let finishSweep!: () => void;
    const sweep = new Promise<void>((resolve) => {
      finishSweep = resolve;
    });
    const expireSeatHolds = jest
      .spyOn(service, "expireSeatHolds")
      .mockImplementationOnce(async () => {
        await sweep;
        return { expired: 0 };
      })
      .mockResolvedValue({ expired: 0 });

    const first = (service as unknown as { runExpirySweep(): Promise<void> }).runExpirySweep();
    await (service as unknown as { runExpirySweep(): Promise<void> }).runExpirySweep();

    expect(expireSeatHolds).toHaveBeenCalledTimes(1);
    finishSweep();
    await first;

    await (service as unknown as { runExpirySweep(): Promise<void> }).runExpirySweep();
    expect(expireSeatHolds).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failed expiry sweep", async () => {
    const service = new CinemaService();
    const expireSeatHolds = jest
      .spyOn(service, "expireSeatHolds")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ expired: 0 });
    const logger = (service as unknown as {
      logger: { error: (message: unknown, ...optionalParams: unknown[]) => void };
    }).logger;
    const logError = jest.spyOn(logger, "error").mockImplementation(() => undefined);
    const runSweep = () =>
      (service as unknown as { runExpirySweep(): Promise<void> }).runExpirySweep();

    await expect(runSweep()).resolves.toBeUndefined();
    await expect(runSweep()).resolves.toBeUndefined();

    expect(expireSeatHolds).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      "Seat-hold expiry sweep failed.",
      "Error: database unavailable",
    );
  });
});
