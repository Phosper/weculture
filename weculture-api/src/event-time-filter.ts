export const EVENT_TIME_FILTERS = ['all', 'upcoming', 'today', 'week'] as const;
export type EventTimeFilter = typeof EVENT_TIME_FILTERS[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// Event fields already store UTC instants. Return Date parameters so TypeORM's
// database drivers serialize them in the same format as the event columns.
// Asia/Shanghai has no daylight-saving transitions for current activity dates.
export function eventTimeBounds(filter: Exclude<EventTimeFilter, 'all'>, now = new Date()): { from: Date; until?: Date } {
  const from = new Date(now.getTime());
  if (filter === 'upcoming') return { from };
  const shanghaiDayStart = Math.floor((now.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
  return { from, until: new Date(shanghaiDayStart + (filter === 'today' ? 1 : 7) * DAY_MS) };
}
