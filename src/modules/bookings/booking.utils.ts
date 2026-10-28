import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { BookingSettings } from '../businesses/business.schema';

export interface ScheduleDay {
  day: number;
  isWorking: boolean;
  start: string;
  end: string;
  breaks: { start: string; end: string }[];
}

export function businessDefaultSchedule(settings?: Partial<BookingSettings> | null): ScheduleDay[] {
  const configured = settings?.weeklyHours;
  if (configured?.length) {
    return configured.map((d) => ({
      day: d.day,
      isWorking: d.isOpen,
      start: d.start,
      end: d.end,
      breaks: [],
    }));
  }
  return [
    { day: 1, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 2, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 3, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 4, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 5, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 6, isWorking: true, start: '10:00', end: '16:00', breaks: [] },
    { day: 0, isWorking: false, start: '00:00', end: '00:00', breaks: [] },
  ];
}

export function minutesFromTime(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function timeFromMinutes(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function localDateKey(date: Date, timezone: string): string {
  const local = toZonedTime(date, timezone);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

export function isoDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

export function zonedDate(date: string, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

export function weekdayForDate(date: string, timezone: string): number {
  const midday = fromZonedTime(`${date}T12:00:00`, timezone);
  return toZonedTime(midday, timezone).getDay();
}

export function timeOffContains(dayStart: Date, dayEnd: Date, timeOff: { startAt: Date; endAt: Date }[]): boolean {
  return timeOff.some((off) => off.startAt < dayEnd && off.endAt > dayStart);
}

export function isValidLocalDate(date: string): boolean {
  const parts = isoDateParts(date);
  if (!parts) return false;
  const d = new Date(Date.UTC(parts.year, parts.month, parts.day));
  return d.getUTCFullYear() === parts.year && d.getUTCMonth() === parts.month && d.getUTCDate() === parts.day;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}
