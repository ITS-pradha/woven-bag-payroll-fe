/** "2026-09-24" → "24 Sep 2026". Tanggal kalender, tanpa pergeseran zona. */
const DAY_FORMAT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDay(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : DAY_FORMAT.format(date);
}
