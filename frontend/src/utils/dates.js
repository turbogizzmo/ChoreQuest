/** Format a Date object as YYYY-MM-DD using LOCAL time (not UTC). */
export function toLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayLocalISO() {
  return toLocalISO(new Date());
}
