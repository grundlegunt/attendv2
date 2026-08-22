export function percentageToPermille(value: string): number {
  const percentage = Number(value);
  if (!value.trim() || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Enter a tax rate from 0% to 100%.");
  }
  return Math.round(percentage * 10);
}
