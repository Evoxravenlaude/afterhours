/**
 * NYSE regular-session calendar. Times are computed in America/New_York so DST is handled by Intl.
 * Holidays and early closes for 2026–2027 are from the published NYSE schedule; extend yearly.
 */
const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]); // 13:00 ET

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;

interface EtParts { date: string; minutes: number; weekday: number }

function etParts(ms: number): EtParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday as string);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute), weekday: wd };
}

/** UTC ms for a given ET wall-clock date and minute-of-day. */
function etToUtc(date: string, minutes: number): number {
  const [y, m, d] = date.split("-").map(Number);
  // Start from a UTC guess, then correct by the ET offset at that instant (handles DST).
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const p = etParts(guess);
  const diffMin = (p.date === date ? p.minutes : p.minutes - 24 * 60) - minutes;
  return guess - diffMin * 60_000;
}

export function isTradingDay(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(date);
}

export function sessionFor(date: string): { open: number; close: number } | null {
  if (!isTradingDay(date)) return null;
  const closeMin = EARLY_CLOSE.has(date) ? EARLY_CLOSE_MIN : CLOSE_MIN;
  return { open: etToUtc(date, OPEN_MIN), close: etToUtc(date, closeMin) };
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function isOpen(ms: number): boolean {
  const s = sessionFor(etParts(ms).date);
  return !!s && ms >= s.open && ms < s.close;
}

/** The most recent regular-session close at or before `ms`. */
export function lastClose(ms: number): number {
  let date = etParts(ms).date;
  for (let i = 0; i < 10; i++) {
    const s = sessionFor(date);
    if (s && s.close <= ms) return s.close;
    date = addDays(date, -1);
  }
  throw new Error("no close found in 10 days");
}

/** The next regular-session open strictly after `ms`. */
export function nextOpen(ms: number): number {
  let date = etParts(ms).date;
  for (let i = 0; i < 10; i++) {
    const s = sessionFor(date);
    if (s && s.open > ms) return s.open;
    date = addDays(date, 1);
  }
  throw new Error("no open found in 10 days");
}

/** Hours the exchange has been closed as of `ms` (0 while open). */
export function hoursClosed(ms: number): number {
  return isOpen(ms) ? 0 : (ms - lastClose(ms)) / 3_600_000;
}

export const _internal = { etParts, etToUtc, addDays };
