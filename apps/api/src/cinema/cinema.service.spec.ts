import { CinemaService } from "./cinema.service";

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
