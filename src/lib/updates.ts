// In-app updates through the Tauri updater: checks GitHub Releases for a
// signed newer build, downloads it, installs it and restarts Harbor.
import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { notify } from "../widgets/kit";
import { UpdateSettings } from "./api";

const EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: Date }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; done: number; total: number | null }
  | { kind: "installing"; update: Update }
  | { kind: "error"; message: string };

/**
 * Runs in the (always loaded, usually hidden) settings window so there is one
 * updater per app. Checks on start and every 6 hours when enabled, on the
 * tray's "Check for updates…", and when the user clicks the button.
 */
export function useUpdater(settings: UpdateSettings | undefined) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const busy = useRef(false);
  const notified = useRef<string | null>(null);
  const found = useRef<Update | null>(null);
  const auto = useRef(settings);
  auto.current = settings;

  const install = async (update: Update) => {
    let done = 0;
    let total: number | null = null;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? null;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "downloading", update, done, total });
        }
        if (e.event === "Finished") setState({ kind: "installing", update });
      });
      // On Windows the installer usually closes Harbor itself; relaunch covers the rest.
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: `Couldn't install the update: ${e}` });
    }
  };

  const run = async (manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setState({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        setState({ kind: "current", checkedAt: new Date() });
      } else {
        setState({ kind: "available", update });
        found.current = update;
        // Lets the dock show its Update button.
        emit("update-available", { version: update.version });
        if (!manual && auto.current?.autoInstall) {
          await install(update);
        } else if (!manual && notified.current !== update.version) {
          notified.current = update.version;
          notify(`Harbor ${update.version} is available`, "Open Settings → Updates to install it.");
        }
      }
    } catch (e) {
      // Background checks fail quietly (offline, no release yet); manual ones explain.
      if (manual) setState({ kind: "error", message: `Couldn't check for updates: ${e}` });
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!settings?.autoCheck) return;
    const first = setTimeout(() => run(false), 15_000); // let startup settle
    const id = setInterval(() => run(false), EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [settings?.autoCheck]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const offs = [
      listen("check-updates", () => run(true)),
      // The dock's Update button.
      listen("install-update", () => {
        if (found.current) install(found.current);
      }),
    ];
    return () => {
      offs.forEach((p) => p.then((f) => f()));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { state, check: () => run(true), install };
}
