// Prayer times: a panel widget, its settings form, and helpers the dock pill
// and the notch share. Times are calculated by the backend from the shared
// location; nothing is fetched.
import { PrayerDay, WidgetConfig } from "../lib/api";
import { usePrayer } from "./data";
import { Tile, useNow, WidgetProps } from "./kit";
import { LocationPicker } from "./weather";

type Key = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";

export const PRAYERS: [Key, string][] = [
  ["fajr", "Fajr"],
  ["sunrise", "Sunrise"],
  ["dhuhr", "Dhuhr"],
  ["asr", "Asr"],
  ["maghrib", "Maghrib"],
  ["isha", "Isha"],
];

export const METHODS: [string, string][] = [
  ["kemenag", "Kemenag (Indonesia)"],
  ["mwl", "Muslim World League"],
  ["isna", "ISNA (North America)"],
  ["egypt", "Egyptian Authority"],
  ["karachi", "Karachi"],
  ["makkah", "Umm al-Qura (Makkah)"],
];

/** The next prayer after `now` (sunrise is listed but isn't a prayer). */
export function nextPrayer(d: PrayerDay, now: number): { key: Key; name: string; at: number } | null {
  for (const [key, name] of PRAYERS) {
    const at = d[key];
    if (key !== "sunrise" && at !== null && at > now) return { key, name, at };
  }
  return d.nextFajr !== null ? { key: "fajr", name: "Fajr", at: d.nextFajr } : null;
}

export const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

export function countdown(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Today's times with the next one highlighted. Shared by the widget and the notch. */
export function PrayerList({ day, now }: { day: PrayerDay; now: number }) {
  const next = nextPrayer(day, now);
  return (
    <div className="w-prayer-list">
      {PRAYERS.map(([key, name]) => {
        const at = day[key];
        const cls = key === next?.key && next.at === at ? " next" : at !== null && at < now ? " past" : "";
        return (
          <div key={key} className={"w-prayer" + cls}>
            <span className="w-small">{name}</span>
            <b>{at === null ? "—" : hhmm(at)}</b>
          </div>
        );
      })}
    </div>
  );
}

type Props = WidgetProps<Record<string, never>>;

export function PrayerTimes({ shared, updateShared }: Props) {
  const now = useNow(15_000).getTime();
  const { data, error } = usePrayer(shared);
  if (!shared.location) {
    return (
      <Tile title="Prayer times">
        <p className="w-muted w-small">Pick a city to see prayer times.</p>
        <LocationPicker shared={shared} updateShared={updateShared} />
      </Tile>
    );
  }
  const next = data && nextPrayer(data, now);
  return (
    <Tile title={`Prayer times · ${shared.location.name}`}>
      {data ? (
        <>
          {next && (
            <div className="w-row">
              <span className="w-big">{next.name}</span>
              <span className="w-muted">
                {hhmm(next.at)} · in {countdown(next.at - now)}
              </span>
            </div>
          )}
          <PrayerList day={data} now={now} />
        </>
      ) : (
        <p className="w-muted">{error ?? "Calculating…"}</p>
      )}
    </Tile>
  );
}

/** Method and Asr convention (shared by every prayer view) plus the city. */
export function PrayerSettingsFields({ shared, updateShared }: { shared: WidgetConfig; updateShared: (p: Partial<WidgetConfig>) => void }) {
  return (
    <>
      <label className="w-field">
        <span className="w-small w-muted">Calculation method</span>
        <select className="w-input" value={shared.prayerMethod} onChange={(e) => updateShared({ prayerMethod: e.target.value })}>
          {METHODS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="w-field">
        <span className="w-small w-muted">Asr</span>
        <select
          className="w-input"
          value={shared.prayerAsr}
          onChange={(e) => updateShared({ prayerAsr: e.target.value as WidgetConfig["prayerAsr"] })}
        >
          <option value="standard">Standard (Shafi'i, Maliki, Hanbali)</option>
          <option value="hanafi">Hanafi</option>
        </select>
      </label>
    </>
  );
}

export const PrayerForm = ({ shared, updateShared }: Props) => (
  <div className="w-form">
    <PrayerSettingsFields shared={shared} updateShared={updateShared} />
    <p className="w-small w-muted">City: {shared.location?.name ?? "not set"}</p>
    <LocationPicker shared={shared} updateShared={updateShared} />
  </div>
);
