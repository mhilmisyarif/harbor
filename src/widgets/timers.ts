// Timer state machines shared by the panel tiles and the dock pills. Each keeps
// an end/start timestamp and derives the time from the clock, so it stays right
// while its window is hidden.
import { useEffect, useState } from "react";
import { fmtDuration, notify } from "./kit";

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

export type Phase = "focus" | "short" | "long";
export const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

export function usePomodoro(settings: PomodoroSettings) {
  const minutes = (p: Phase) => (p === "focus" ? settings.focus : p === "short" ? settings.shortBreak : settings.longBreak);
  const [phase, setPhase] = useState<Phase>("focus");
  const [round, setRound] = useState(1);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [leftMs, setLeftMs] = useState(settings.focus * 60_000);
  useTicker(endAt !== null);

  const total = minutes(phase) * 60_000;
  const remaining = endAt !== null ? Math.max(0, endAt - Date.now()) : leftMs;
  const running = endAt !== null;

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
    if (running && remaining <= 0) advance(true);
  });

  useEffect(() => {
    if (!running) setLeftMs(minutes(phase) * 60_000);
  }, [settings.focus, settings.shortBreak, settings.longBreak]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    phase,
    round,
    remaining,
    total,
    running,
    label: fmtDuration(remaining / 1000),
    toggle: () => {
      if (running) {
        setLeftMs(remaining);
        setEndAt(null);
      } else {
        setEndAt(Date.now() + remaining);
      }
    },
    skip: () => advance(false),
    reset: () => {
      setPhase("focus");
      setRound(1);
      setEndAt(null);
      setLeftMs(settings.focus * 60_000);
    },
  };
}

// ---------- Timer ----------

export function useCountdown(initialMinutes = 5) {
  const [duration, setDuration] = useState(initialMinutes * 60_000);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [leftMs, setLeftMs] = useState(duration);
  useTicker(endAt !== null);
  const remaining = endAt !== null ? Math.max(0, endAt - Date.now()) : leftMs;
  const running = endAt !== null;

  useEffect(() => {
    if (running && remaining <= 0) {
      setEndAt(null);
      setLeftMs(duration);
      notify("Timer finished", `${fmtDuration(duration / 1000)} is up.`);
    }
  });

  return {
    duration,
    remaining,
    running,
    paused: !running && remaining < duration,
    label: fmtDuration(remaining / 1000),
    start: (ms: number) => {
      setDuration(ms);
      setLeftMs(ms);
      setEndAt(Date.now() + ms);
    },
    toggle: () => {
      if (running) {
        setLeftMs(remaining);
        setEndAt(null);
      } else {
        setEndAt(Date.now() + remaining);
      }
    },
    reset: () => {
      setEndAt(null);
      setLeftMs(duration);
    },
  };
}

// ---------- Stopwatch ----------

export const fmtStopwatch = (ms: number) => `${fmtDuration(Math.floor(ms / 1000))}.${Math.floor((ms % 1000) / 100)}`;

export function useStopwatch() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [banked, setBanked] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  useTicker(startedAt !== null);
  const elapsed = banked + (startedAt !== null ? Date.now() - startedAt : 0);
  const running = startedAt !== null;
  return {
    elapsed,
    running,
    laps,
    toggle: () => {
      if (running) {
        setBanked(elapsed);
        setStartedAt(null);
      } else {
        setStartedAt(Date.now());
      }
    },
    lap: () => setLaps((l) => [elapsed, ...l].slice(0, 20)),
    reset: () => {
      setStartedAt(null);
      setBanked(0);
      setLaps([]);
    },
  };
}
