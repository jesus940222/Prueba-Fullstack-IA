const ZONE = "America/Mexico_City";

export interface MexicoDay {
  key: string;
  start: Date;
  next: Date;
}

export function mexicoDay(instant: Date, zone = ZONE): MexicoDay {
  if (zone !== ZONE) {
    throw new Error("invalid_time_zone");
  }
  const key = calendarKey(instant, zone);
  const [year, month, day] = key.split("-").map((part) => Number(part));
  const start = zonedMidnight(year ?? 0, month ?? 1, day ?? 1, zone);
  const nextDate = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) + 24 * 60 * 60 * 1000);
  const next = zonedMidnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), zone);
  return { key, start, next };
}

function calendarKey(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.year}-${bag.month}-${bag.day}`;
}

function zonedMidnight(year: number, month: number, day: number, zone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const observed = Date.UTC(Number(bag.year), Number(bag.month) - 1, Number(bag.day), Number(bag.hour), Number(bag.minute), Number(bag.second));
  const wanted = Date.UTC(year, month - 1, day, 0, 0, 0);
  return new Date(guess.getTime() - (observed - wanted));
}
