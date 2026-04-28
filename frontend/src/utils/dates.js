/**
 * Return a human-readable relative time string for a datetime string from the
 * backend. The backend stores datetimes as naive UTC without a timezone suffix,
 * so we append 'Z' when no offset is present to ensure correct UTC parsing.
 */
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  // Append 'Z' if the string has no timezone info so it's parsed as UTC
  const utcStr = /Z|[+-]\d\d:?\d\d$/.test(dateStr) ? dateStr : dateStr + 'Z';
  const diff = Date.now() - new Date(utcStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
