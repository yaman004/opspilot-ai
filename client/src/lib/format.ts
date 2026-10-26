import { formatDuration } from '@opspilot/shared';

/** All timestamps arrive as UTC ISO strings and are rendered in the viewer's local time zone. */
export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}
export function fmtDay(isoDay: string): string {
  // trend buckets are UTC days
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${isoDay}T00:00:00Z`));
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso || !rtf) return '—';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];
  for (const [unit, ms] of units) if (abs >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
  return '—';
}

export const fmtMs = (ms: number | null | undefined) => formatDuration(ms);
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
export const toLocalInputValue = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
