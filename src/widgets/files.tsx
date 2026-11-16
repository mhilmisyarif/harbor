// Recycle Bin, Search and LeetCode stats.
import { useState } from "react";
import { api } from "../lib/api";
import { fmtBytes, Ring, setShared, Tile, useShared, WidgetProps } from "./kit";

export function RecycleBin() {
  const { data } = useShared("recycle-bin", api.recycleBin, 5000);
  const empty = async () => {
    await api.emptyRecycleBin(); // Windows shows its own confirmation
    setShared("recycle-bin", await api.recycleBin());
  };
  return (
    <Tile title="Recycle Bin">
      <div className="w-row">
        <span className="w-big">{data?.items === 0 ? "🗑️" : "🗑️"}</span>
        <div className="w-right">
          <b>{data ? (data.items === 0 ? "Empty" : `${data.items} item${data.items === 1 ? "" : "s"}`) : "…"}</b>
          {data && data.items > 0 && <div className="w-muted w-small">{fmtBytes(data.bytes)}</div>}
        </div>
      </div>
      <div className="w-row w-gap">
        <button className="w-btn" onClick={() => api.shellAction("recycle-bin")}>
          Open
        </button>
        <button className="w-btn w-danger" disabled={!data || data.items === 0} onClick={empty}>
          Empty…
        </button>
      </div>
    </Tile>
  );
}

export function Search() {
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () =>
    api.searchOrOpen(q).then(
      () => (setQ(""), setError(null)),
      (e) => setError(String(e)),
    );
  return (
    <Tile title="Search">
      <input
        className="w-input"
        placeholder="Search the web, or type a folder like C:\Users"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}

export interface UserSettings {
  username: string;
}

export function LeetCode({ settings }: WidgetProps<UserSettings>) {
  const user = settings.username.trim();
  const { data, error } = useShared(user ? `leetcode:${user.toLowerCase()}` : null, () => api.leetcode(user), 30 * 60_000);
  if (!user) {
    return (
      <Tile title="LeetCode">
        <p className="w-muted w-small">Set your username with ⚙ in edit mode.</p>
      </Tile>
    );
  }
  const u = data?.data?.matchedUser;
  const solved = (d: string) => u?.submitStatsGlobal.acSubmissionNum.find((x) => x.difficulty === d)?.count ?? 0;
  const total = data?.data?.allQuestionsCount.find((x) => x.difficulty === "All")?.count ?? 0;
  return (
    <Tile title={`LeetCode · ${user}`}>
      {u ? (
        <div className="w-row w-gap">
          <Ring value={total ? solved("All") / total : 0} color="#fbbf24">
            <b>{solved("All")}</b>
          </Ring>
          <div className="w-grow">
            <div className="w-row w-small"><span className="w-lc-easy">Easy</span><b>{solved("Easy")}</b></div>
            <div className="w-row w-small"><span className="w-lc-med">Medium</span><b>{solved("Medium")}</b></div>
            <div className="w-row w-small"><span className="w-lc-hard">Hard</span><b>{solved("Hard")}</b></div>
            <div className="w-row w-small w-muted">
              <span>🔥 Streak</span>
              <b>{u.userCalendar?.streak ?? 0} days</b>
            </div>
          </div>
        </div>
      ) : (
        <p className="w-muted">{data && !u ? "No such user" : error ?? "Loading…"}</p>
      )}
    </Tile>
  );
}

export function LeetCodeForm({ settings, setSettings }: WidgetProps<UserSettings>) {
  const [v, setV] = useState(settings.username);
  return (
    <div className="w-form">
      <input
        className="w-input"
        placeholder="LeetCode username"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => setSettings({ username: v.trim() })}
        onKeyDown={(e) => e.key === "Enter" && setSettings({ username: v.trim() })}
      />
      <p className="w-muted w-small">Uses your public profile; no sign-in.</p>
    </div>
  );
}
