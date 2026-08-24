export function percentageToPermille(value: string): number {
  const normalized = value.trim();
  const percentage = Number(normalized);
  if (!normalized || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Enter a tax rate from 0% to 100%.");
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a tax rate with no more than two decimal places.");
  }
  return Math.round(percentage * 100) / 10;
}

export function formatPermillePercentage(ratePermille: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(ratePermille / 10);
}
