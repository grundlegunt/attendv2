export function isCheckoutHoldExpired(remainingSeconds: number): boolean {
  return !Number.isFinite(remainingSeconds) || remainingSeconds <= 0;
}
