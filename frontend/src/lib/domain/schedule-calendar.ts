export type CalendarInterval = { startAt: string; endAt: string };

export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Group intervals by every overlapping local calendar day. End times are exclusive.
 * Work is bounded to the visible six-week grid, even for years of availability.
 * Local midnight construction also handles 23/25-hour daylight-saving days.
 */
export function groupCalendarDays<T>(
  items: readonly T[],
  interval: (item: T) => CalendarInterval,
  year: number,
  month: number
): Map<string, T[]> {
  const first = new Date(year, month, 1);
  first.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { key: calendarDayKey(start), start: start.getTime(), end: end.getTime() };
  });
  const result = new Map<string, T[]>();
  for (const item of items) {
    const range = interval(item);
    const start = Date.parse(range.startAt);
    const end = Date.parse(range.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (const day of days) {
      if (start >= day.end || end <= day.start) continue;
      const entries = result.get(day.key) ?? [];
      entries.push(item);
      result.set(day.key, entries);
    }
  }
  return result;
}
