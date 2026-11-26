export const bankTimeZone = 'Asia/Kolkata';

const day = /^\d{4}-\d{2}-\d{2}$/;
const instant = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const offset = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const dayLabel = new Intl.DateTimeFormat('en-IN', {
  timeZone: bankTimeZone, day: '2-digit', month: 'short', year: 'numeric',
});
const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: bankTimeZone, day: '2-digit', month: '2-digit', year: 'numeric',
});
const timestampLabel = new Intl.DateTimeFormat('en-IN', {
  timeZone: bankTimeZone, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
});
const timestampWithSeconds = new Intl.DateTimeFormat('en-IN', {
  timeZone: bankTimeZone, dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23',
});

// Oracle responses include both offset-bearing instants and legacy UTC timestamps without an offset.
export function timestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(
    instant.test(value) ? value.replace(' ', 'T') + (offset.test(value) ? '' : 'Z') : value,
  );
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function date(value: string | Date | null | undefined, empty = '—'): string {
  const parsed = timestamp(value);
  return parsed ? dayLabel.format(parsed) : empty;
}

export function dateTime(value: string | Date | null | undefined, empty = '—', seconds = false): string {
  const parsed = timestamp(value);
  if (!parsed) return empty;
  if (typeof value === 'string' && day.test(value)) return dayLabel.format(parsed);
  return (seconds ? timestampWithSeconds : timestampLabel).format(parsed) + ' IST';
}

export function businessDate(value: string | Date | null | undefined): string {
  const parsed = timestamp(value);
  if (!parsed) return '';
  const parts = Object.fromEntries(dayKey.formatToParts(parsed).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const localDate = () => businessDate(new Date());
export const bankDateAfter = (days: number) => businessDate(new Date(Date.now() + days * 86400000));
