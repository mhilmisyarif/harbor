// Pomodoro, timer, stopwatch, todos, notes, calendar and currency.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtDuration, fmtPrice, notify, Ring, Tile, useNow, useShared, WidgetProps } from "./kit";

/**
 * Timers must keep counting while the panel is hidden and survive re-renders,
 * so they store an end timestamp and derive the remaining time from the clock.
 */
function useTicker(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
}

// ---------- Pomodoro ----------

export interface PomodoroSettings {
  focus: number;
  shortBreak: number;
  longBreak: number;
  rounds: number;
}

type Phase = "focus" | "short" | "long";
const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

export function Pomodoro({ settings }: WidgetProps<PomodoroSettings>) {
  const minutes = (p: Phase) => (p === "focus" ? settings.focus : p === "short" ? settings.shortBreak : settings.longBreak);
  const [phase, setPhase] = useState<Phase>("focus");
  const [round, setRound] = useState(1);
  const [endAt, setEndAt] = useState<number | null>(null); // running when set
  const [leftMs, setLeftMs] = useState(settings.focus * 60_000); // when paused
  useTicker(endAt !== null);

  const total = minutes(phase) * 60_000;
  const remaining = endAt !== null ? Math.max(0, endAt - Date.now()) : leftMs;

  const advance = (fromTimer: boolean) => {
    let next: Phase;
    let nextRound = round;
    if (phase === "focus") {
      next = round >= settings.rounds ? "long" : "short";
    } else {
      next = "focus";
      nextRound = phase === "long" ? 1 : round + 1;
    }
    if (fromTimer) notify(`${PHASE_LABEL[phase]} finished`, `Time for: ${PHASE_LABEL[next].toLowerCase()}.`);
    setPhase(next);
    setRound(nextRound);
    const ms = minutes(next) * 60_000;
    setLeftMs(ms);
    setEndAt(fromTimer ? Date.now() + ms : null); // keep the cycle running after a phase ends
  };

  useEffect(() => {
    if (endAt !== null && remaining <= 0) advance(true);
  }); // checks on every tick

  // Reset the idle timer when the durations change.
  useEffect(() => {
    if (endAt === null) setLeftMs(minutes(phase) * 60_000);
  }, [settings.focus, settings.shortBreak, settings.longBreak]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (endAt !== null) {
      setLeftMs(remaining);
      setEndAt(null);
    } else {
      setEndAt(Date.now() + remaining);
    }
  };

  return (
    <Tile title={`${PHASE_LABEL[phase]} · ${round}/${settings.rounds}`}>
      <div className="w-row">
        <Ring value={1 - remaining / total} color={phase === "focus" ? "#f87171" : "#4ade80"}>
          <b>{fmtDuration(remaining / 1000)}</b>
        </Ring>
        <div className="w-col">
          <button className="w-btn w-primary" onClick={toggle}>
            {endAt !== null ? "Pause" : remaining < total ? "Resume" : "Start"}
          </button>
          <button className="w-btn" onClick={() => advance(false)}>
            Skip
          </button>
          <button
            className="w-btn"
            onClick={() => {
              setPhase("focus");
              setRound(1);
              setEndAt(null);
              setLeftMs(settings.focus * 60_000);
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </Tile>
  );
}

export function PomodoroForm({ settings, setSettings }: WidgetProps<PomodoroSettings>) {
  const num = (key: keyof PomodoroSettings, label: string, max: number) => (
    <label className="w-field">
      {label}
      <input
        className="w-input w-num-input"
        type="number"
        min={1}
        max={max}
        value={settings[key]}
        onChange={(e) => setSettings({ [key]: Math.min(max, Math.max(1, Number(e.target.value) || 1)) })}
      />
    </label>
  );
  return (
    <div className="w-form">
      {num("focus", "Focus (min)", 180)}
      {num("shortBreak", "Short break (min)", 60)}
      {num("longBreak", "Long break (min)", 120)}
      {num("rounds", "Rounds before a long break", 12)}
    </div>
  );
}

// ---------- Timer ----------

const PRESETS = [1, 5, 10, 15, 25, 45];

export function Timer() {
  const [duration, setDuration] = useState(5 * 60_000);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [leftMs, setLeftMs] = useState(duration);
  const [custom, setCustom] = useState("");
  useTicker(endAt !== null);
  const remaining = endAt !== null ? Math.max(0, endAt - Date.now()) : leftMs;

  useEffect(() => {
    if (endAt !== null && remaining <= 0) {
      setEndAt(null);
      setLeftMs(duration);
      notify("Timer finished", `${fmtDuration(duration / 1000)} is up.`);
    }
  });

  const start = (ms: number) => {
    setDuration(ms);
    setLeftMs(ms);
    setEndAt(Date.now() + ms);
  };

  return (
    <Tile title="Timer">
      <div className="w-row">
        <Ring value={endAt !== null || remaining < duration ? 1 - remaining / duration : 0}>
          <b>{fmtDuration(remaining / 1000)}</b>
        </Ring>
        <div className="w-col">
          {endAt !== null ? (
            <button className="w-btn w-primary" onClick={() => (setLeftMs(remaining), setEndAt(null))}>
              Pause
            </button>
          ) : remaining < duration ? (
            <button className="w-btn w-primary" onClick={() => setEndAt(Date.now() + remaining)}>
              Resume
            </button>
          ) : (
            <button className="w-btn w-primary" onClick={() => start(duration)}>
              Start
            </button>
          )}
          <button className="w-btn" onClick={() => (setEndAt(null), setLeftMs(duration))}>
            Reset
          </button>
        </div>
      </div>
      <div className="w-chips">
        {PRESETS.map((m) => (
          <button key={m} className="w-chip" onClick={() => start(m * 60_000)}>
            {m}m
          </button>
        ))}
        <input
          className="w-input w-chip-input"
          placeholder="min"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={(e) => {
            const m = Number(custom);
            if (e.key === "Enter" && m > 0 && m <= 24 * 60) start(m * 60_000);
          }}
        />
      </div>
    </Tile>
  );
}

// ---------- Stopwatch ----------

export function Stopwatch() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [banked, setBanked] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  useTicker(startedAt !== null);
  const elapsed = banked + (startedAt !== null ? Date.now() - startedAt : 0);
  const fmt = (ms: number) => `${fmtDuration(Math.floor(ms / 1000))}.${String(Math.floor((ms % 1000) / 100))}`;

  return (
    <Tile title="Stopwatch">
      <div className="w-clock-big w-center-text">{fmt(elapsed)}</div>
      <div className="w-row w-gap">
        {startedAt !== null ? (
          <button className="w-btn w-primary" onClick={() => (setBanked(elapsed), setStartedAt(null))}>
            Pause
          </button>
        ) : (
          <button className="w-btn w-primary" onClick={() => setStartedAt(Date.now())}>
            {elapsed ? "Resume" : "Start"}
          </button>
        )}
        <button className="w-btn" disabled={!elapsed} onClick={() => setLaps((l) => [elapsed, ...l].slice(0, 20))}>
          Lap
        </button>
        <button className="w-btn" onClick={() => (setStartedAt(null), setBanked(0), setLaps([]))}>
          Reset
        </button>
      </div>
      {laps.length > 0 && (
        <div className="w-laps">
          {laps.map((t, i) => (
            <div key={i} className="w-row w-small">
              <span className="w-muted">Lap {laps.length - i}</span>
              <span>{fmt(t - (laps[i + 1] ?? 0))}</span>
              <span className="w-muted">{fmt(t)}</span>
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ---------- Todos & Notes (user content lives in widget-data files) ----------

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    api.loadWidgetData<T>(key).then((v) => {
      if (v !== null && v !== undefined) setValue(v);
      loaded.current = true;
    });
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => api.saveWidgetData(key, value).catch(console.error), 400);
    return () => clearTimeout(t);
  }, [key, value]);
  return [value, setValue] as const;
}

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export function Todos({ id }: WidgetProps<Record<string, never>>) {
  const [todos, setTodos] = usePersisted<Todo[]>(`todos-${id}`, []);
  const [text, setText] = useState("");
  const done = todos.filter((t) => t.done).length;
  const next = todos.find((t) => !t.done);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setTodos((list) => [...list, { id: crypto.randomUUID(), text: t, done: false }]);
    setText("");
  };
  return (
    <Tile title="Todos">
      <div className="w-row">
        <Ring value={todos.length ? done / todos.length : 0} size={56} stroke={6} color="#4ade80">
          <span className="w-small">
            {done}/{todos.length}
          </span>
        </Ring>
        <div className="w-grow">
          <div className="w-muted w-small">Next up</div>
          <div className="w-ellipsis">{next ? next.text : todos.length ? "All done 🎉" : "Nothing yet"}</div>
        </div>
      </div>
      <div className="w-todo-list">
        {todos.map((t) => (
          <div key={t.id} className={"w-todo" + (t.done ? " done" : "")}>
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => setTodos((l) => l.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
            />
            <span className="w-grow">{t.text}</span>
            <button className="w-x" title="Delete" onClick={() => setTodos((l) => l.filter((x) => x.id !== t.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="w-row w-gap">
        <input
          className="w-input"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        {done > 0 && (
          <button className="w-btn" onClick={() => setTodos((l) => l.filter((t) => !t.done))}>
            Clear done
          </button>
        )}
      </div>
    </Tile>
  );
}

export function Notes({ id }: WidgetProps<Record<string, never>>) {
  const [note, setNote] = usePersisted<string>(`notes-${id}`, "");
  return (
    <Tile title="Notes">
      <textarea
        className="w-input w-notes"
        placeholder="Write something…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Tile>
  );
}

// ---------- Calendar ----------

export function Calendar() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = useNow(60_000);
  const firstWeekday = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const isToday = (d: number) =>
    d === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <Tile>
      <div className="w-row">
        <button className="w-link" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <b>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
        <button className="w-link" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="w-cal">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} className="w-muted">
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span key={i} className={d && isToday(d) ? "w-today" : ""}>
            {d ?? ""}
          </span>
        ))}
      </div>
    </Tile>
  );
}

// ---------- Currency ----------

export function Currency({ shared, updateShared }: WidgetProps<Record<string, never>>) {
  const [amount, setAmount] = useState(1);
  const [editing, setEditing] = useState(false);
  const { data, error } = useShared(
    `fx:${shared.fxBase}:${shared.fxQuotes.join(",")}`,
    () => api.fx(shared.fxBase, shared.fxQuotes),
    60 * 60_000,
  );
  const [text, setText] = useState([shared.fxBase, ...shared.fxQuotes].join(", "));
  return (
    <Tile
      title={
        <span className="w-row">
          Currency
          <button className="w-link" onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Edit"}
          </button>
        </span>
      }
    >
      {editing ? (
        <input
          className="w-input"
          autoFocus
          value={text}
          placeholder="USD, EUR, JPY (first is the base)"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const [base, ...quotes] = text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
            if (base) updateShared({ fxBase: base, fxQuotes: quotes });
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="w-row w-gap">
            <input
              className="w-input w-num-input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            />
            <b>{shared.fxBase}</b>
          </div>
          {data &&
            Object.entries(data.rates).map(([code, rate]) => (
              <div key={code} className="w-row">
                <span className="w-sym">{code}</span>
                <span className="w-num">{fmtPrice(rate * amount)}</span>
              </div>
            ))}
          {data && <p className="w-muted w-small">ECB reference rates, {data.date}</p>}
        </>
      )}
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}
