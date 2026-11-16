// Calendar events from iCal links: the agenda (calendar card / panel) and
// the "next event" dock pill.
import { api, CalEvent } from "../lib/api";
import { Tile, useNow, useShared } from "./kit";

export const useEvents = (days = 14) => useShared(`calendar:${days}`, () => api.calendarEvents(days), 5 * 60_000);

const dayKey = (ms: number) => new Date(ms).toDateString();

export function timeRange(e: CalEvent) {
  if (e.allDay) return "All day";
  const t = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${t(e.start)} – ${t(e.end)}`;
}

/** "in 12 min", "now", "tomorrow 09:00". */
export function relative(e: CalEvent, now: number) {
  if (now >= e.start && now < e.end) return "now";
  const mins = Math.round((e.start - now) / 60_000);
  if (mins < 60) return `in ${mins} min`;
  if (mins < 60 * 12 && dayKey(e.start) === dayKey(now)) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  const time = e.allDay ? "" : " " + new Date(e.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const tomorrow = dayKey(e.start) === dayKey(now + 86_400_000);
  return (tomorrow ? "tomorrow" : new Date(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })) + time;
}

/** Next timed event that hasn't ended (all-day events don't count as "next"). */
export function nextEvent(events: CalEvent[] | undefined, now: number) {
  return events?.find((e) => !e.allDay && e.end > now);
}

export function Agenda() {
  const { data, error } = useEvents(14);
  const now = useNow(30_000).getTime();
  const events = (data?.events ?? []).filter((e) => e.end > now).slice(0, 12);
  const groups = new Map<string, CalEvent[]>();
  for (const e of events) groups.set(dayKey(e.start), [...(groups.get(dayKey(e.start)) ?? []), e]);
  const label = (k: string) => {
    if (k === dayKey(now)) return "Today";
    if (k === dayKey(now + 86_400_000)) return "Tomorrow";
    return new Date(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };
  return (
    <Tile title="Up next">
      {[...groups.entries()].map(([k, list]) => (
        <div key={k} className="w-agenda-day">
          <div className="w-muted w-small">{label(k)}</div>
          {list.map((e) => (
            <div key={e.id} className={"w-event" + (now >= e.start && now < e.end ? " now" : "")}>
              <span className="w-event-bar" style={{ background: e.color }} />
              <div className="w-grow w-min0">
                <div className="w-ellipsis">
                  <b>{e.title}</b>
                </div>
                <div className="w-muted w-small w-ellipsis">
                  {timeRange(e)}
                  {e.location ? ` · ${e.location}` : ""} · {e.calendar}
                </div>
              </div>
              <span className="w-small w-muted">{relative(e, now)}</span>
            </div>
          ))}
        </div>
      ))}
      {data && events.length === 0 && (
        <p className="w-muted w-small">Nothing coming up. Add calendars in Settings → Calendars.</p>
      )}
      {(data?.errors ?? []).map((e) => (
        <p key={e} className="w-error">
          {e}
        </p>
      ))}
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}

/** Days in the visible month that have events, for dots in the month grid. */
export function useEventDays() {
  const { data } = useEvents(45);
  return new Set((data?.events ?? []).map((e) => dayKey(e.start)));
}
