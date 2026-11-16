// Settings → Calendars (iCal links) and Automations (widgets working together).
import { ReactNode, useState } from "react";
import { Config } from "../lib/api";
import { useWidgetConfig } from "../lib/widgetConfig";
import { useEvents } from "../widgets/calendar";

type Update = (change: (c: Config) => Config) => void;
type RowC = (p: { label: string; hint?: string; children: ReactNode }) => JSX.Element;
type ToggleC = (p: { checked: boolean; onChange: (v: boolean) => void; label: string }) => JSX.Element;

const COLORS = ["#60a5fa", "#f87171", "#4ade80", "#fbbf24", "#a78bfa", "#f472b6"];

export function CalendarsSection({ Row }: { Row: RowC }) {
  const [wc, , updateShared] = useWidgetConfig();
  const { data } = useEvents(14);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!wc) return null;

  const add = () => {
    const u = url.trim();
    if (!/^(https|webcal):\/\//i.test(u)) {
      setError("Paste the calendar's secret iCal address: it starts with https:// or webcal://");
      return;
    }
    setError(null);
    updateShared({
      calendars: [
        ...wc.calendars,
        { id: "c" + Math.random().toString(36).slice(2, 9), name: name.trim() || "Calendar", url: u, color: COLORS[wc.calendars.length % COLORS.length] },
      ],
    });
    setName("");
    setUrl("");
  };

  return (
    <section className="s-section">
      <h2>Calendars</h2>
      <div className="s-card">
        {wc.calendars.map((c) => {
          const failed = data?.errors.find((e) => e.startsWith(c.name + ":"));
          return (
            <div key={c.id} className="s-row">
              <div className="s-cal-name">
                <input
                  type="color"
                  className="s-color"
                  aria-label={`${c.name} color`}
                  value={c.color}
                  onChange={(e) => updateShared({ calendars: wc.calendars.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)) })}
                />
                <div className="s-app-main">
                  <div className="s-label">{c.name}</div>
                  <div className={failed ? "s-error" : "s-hint"}>{failed ?? "Syncs every 15 minutes, read-only."}</div>
                </div>
              </div>
              <button className="s-btn s-danger" onClick={() => updateShared({ calendars: wc.calendars.filter((x) => x.id !== c.id) })}>
                Remove
              </button>
            </div>
          );
        })}
        <div className="s-row s-cal-add">
          <input className="s-input s-cal-input-name" placeholder="Name (e.g. Work)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="s-input" placeholder="Secret iCal address (https://… or webcal://…)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="s-btn s-primary" onClick={add}>
            Add
          </button>
        </div>
        {error && <p className="s-error s-pad">{error}</p>}
        <Row
          label="Where to find the link"
          hint="Google: Calendar settings → your calendar → Secret address in iCal format. Outlook: Settings → Calendar → Shared calendars → Publish a calendar → ICS. iCloud: Calendar → share → Public Calendar."
        >
          <span />
        </Row>
        <p className="s-hint s-pad">The links stay on this PC. Harbor only reads them; it never changes your calendars.</p>
      </div>
    </section>
  );
}

export function AutomationsSection({ config, update, Row, Toggle }: { config: Config; update: Update; Row: RowC; Toggle: ToggleC }) {
  const a = config.automations;
  const set = (patch: Partial<Config["automations"]>) => update((c) => ({ ...c, automations: { ...c.automations, ...patch } }));
  return (
    <section className="s-section">
      <h2>Automations</h2>
      <div className="s-card">
        <Row label="Remind me before events" hint="A notification before each calendar event.">
          <select className="s-input s-select" aria-label="Minutes before" value={a.remindMinutes} disabled={!a.remindBeforeEvents} onChange={(e) => set({ remindMinutes: Number(e.target.value) })}>
            {[1, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} min before
              </option>
            ))}
          </select>
          <Toggle label="Remind me before events" checked={a.remindBeforeEvents} onChange={(remindBeforeEvents) => set({ remindBeforeEvents })} />
        </Row>
        <Row label="Pause music for meetings" hint="When a calendar event starts, pause whatever is playing.">
          <Toggle label="Pause music for meetings" checked={a.pauseMediaForMeetings} onChange={(pauseMediaForMeetings) => set({ pauseMediaForMeetings })} />
        </Row>
        <Row label="Quiet hours" hint="Hold Harbor's notifications during these hours.">
          <input className="s-input s-time" type="time" aria-label="Quiet hours start" value={a.quietStart} disabled={!a.quietHours} onChange={(e) => set({ quietStart: e.target.value })} />
          <span className="s-hint">to</span>
          <input className="s-input s-time" type="time" aria-label="Quiet hours end" value={a.quietEnd} disabled={!a.quietHours} onChange={(e) => set({ quietEnd: e.target.value })} />
          <Toggle label="Quiet hours" checked={a.quietHours} onChange={(quietHours) => set({ quietHours })} />
        </Row>
        <p className="s-hint s-pad">Automations run on this PC; nothing is sent anywhere.</p>
      </div>
    </section>
  );
}
