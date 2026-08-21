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
});
