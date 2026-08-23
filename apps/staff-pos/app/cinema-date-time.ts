export function formatCinemaTime(value: string, timeZone: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function formatCinemaDateTime(value: string, timeZone: string) {
  return new Date(value).toLocaleString([], { timeZone });
}
