// Now Playing (four layouts), output volume and microphone.
import { useEffect, useState } from "react";
import { api, NowPlaying as Np } from "../lib/api";
import { useMicrophone, useNowPlaying, useVolume } from "./data";
import { fmtDuration, Ring, setShared, Tile } from "./kit";

/** Position advances locally between polls while playing. */
function usePosition(np: Np | null | undefined) {
  const [base, setBase] = useState({ at: Date.now(), pos: 0 });
  const [, tick] = useState(0);
  useEffect(() => setBase({ at: Date.now(), pos: np?.positionSecs ?? 0 }), [np?.positionSecs, np?.title]);
  useEffect(() => {
    if (!np?.playing) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [np?.playing]);
  const pos = base.pos + (np?.playing ? (Date.now() - base.at) / 1000 : 0);
  return Math.min(pos, np?.durationSecs || pos);
}

async function control(action: "toggle" | "next" | "previous") {
  try {
    await api.mediaControl(action);
    setShared("now-playing", await api.nowPlaying());
  } catch (e) {
    console.warn(e);
  }
}

const Controls = ({ np, compact }: { np: Np; compact?: boolean }) => (
  <div className="w-media-controls">
    {!compact && (
      <button className="w-media-btn" aria-label="Previous" onClick={() => control("previous")}>
        ⏮
      </button>
    )}
    <button className="w-media-btn w-media-play" aria-label={np.playing ? "Pause" : "Play"} onClick={() => control("toggle")}>
      {np.playing ? "⏸" : "▶"}
    </button>
    <button className="w-media-btn" aria-label="Next" onClick={() => control("next")}>
      ⏭
    </button>
  </div>
);

const Nothing = ({ title }: { title?: string }) => (
  <Tile title={title}>
    <p className="w-muted">Nothing playing</p>
  </Tile>
);

const Art = ({ np, size }: { np: Np; size: number }) =>
  np.art ? (
    <img className="w-art" src={np.art} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="w-art w-art-empty" style={{ width: size, height: size }}>
      ♪
    </span>
  );

export function NowPlaying() {
  const { data: np } = useNowPlaying();
  const pos = usePosition(np);
  if (!np) return <Nothing title="Now playing" />;
  return (
    <Tile>
      <div className="w-row w-gap">
        <Art np={np} size={72} />
        <div className="w-grow w-min0">
          <div className="w-ellipsis"><b>{np.title}</b></div>
          <div className="w-muted w-ellipsis">{np.artist}</div>
          {np.album && <div className="w-muted w-small w-ellipsis">{np.album}</div>}
        </div>
      </div>
      {np.durationSecs > 0 && (
        <>
          <div className="w-meter">
            <div className="w-meter-fill" style={{ width: `${(pos / np.durationSecs) * 100}%` }} />
          </div>
          <div className="w-row w-small w-muted">
            <span>{fmtDuration(pos)}</span>
            <span>{fmtDuration(np.durationSecs)}</span>
          </div>
        </>
      )}
      <Controls np={np} />
    </Tile>
  );
}

export function NowPlayingCompact() {
  const { data: np } = useNowPlaying();
  if (!np) return <Nothing />;
  return (
    <Tile>
      <div className="w-row w-gap">
        <Art np={np} size={40} />
        <div className="w-grow w-min0">
          <div className="w-ellipsis"><b>{np.title}</b></div>
          <div className="w-muted w-small w-ellipsis">{np.artist}</div>
        </div>
        <Controls np={np} compact />
      </div>
    </Tile>
  );
}

export function NowPlayingMini() {
  const { data: np } = useNowPlaying();
  const pos = usePosition(np);
  return (
    <Tile className="w-center">
      <button className="w-mini-play" aria-label="Play or pause" onClick={() => control("toggle")} disabled={!np}>
        <Ring value={np?.durationSecs ? pos / np.durationSecs : 0} size={84} stroke={5}>
          <span className="w-mini-play-icon" style={np?.art ? { backgroundImage: `url(${np.art})` } : undefined}>
            {np?.playing ? "⏸" : "▶"}
          </span>
        </Ring>
      </button>
      <div className="w-small w-ellipsis w-center-text">{np?.title ?? "Nothing playing"}</div>
    </Tile>
  );
}

export function NowPlayingBar() {
  const { data: np } = useNowPlaying();
  const pos = usePosition(np);
  if (!np) return <Nothing />;
  return (
    <Tile>
      <div className="w-row w-gap">
        <div className="w-grow w-min0 w-ellipsis">
          <b>{np.title}</b> <span className="w-muted">· {np.artist}</span>
        </div>
        <button className="w-media-btn" aria-label="Next" onClick={() => control("next")}>
          ⏭
        </button>
      </div>
      <div className="w-meter">
        <div className="w-meter-fill" style={{ width: `${np.durationSecs ? (pos / np.durationSecs) * 100 : 0}%` }} />
      </div>
    </Tile>
  );
}

export function AudioOutput() {
  const { data: vol } = useVolume();
  const [local, setLocal] = useState<number | null>(null);
  const level = local ?? (vol ? Math.round(vol.level * 100) : 0);
  const commit = async () => {
    if (local === null) return;
    setShared("volume", await api.setVolume(local / 100));
    setLocal(null);
  };
  return (
    <Tile title="Sound">
      <div className="w-row w-gap">
        <button
          className="w-media-btn"
          aria-label={vol?.muted ? "Unmute" : "Mute"}
          onClick={async () => setShared("volume", await api.toggleMute())}
        >
          {vol?.muted || level === 0 ? "🔇" : level < 40 ? "🔈" : level < 75 ? "🔉" : "🔊"}
        </button>
        <input
          type="range"
          className="w-range"
          aria-label="Volume"
          min={0}
          max={100}
          value={level}
          onChange={(e) => setLocal(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <span className="w-num w-small">{level}%</span>
      </div>
    </Tile>
  );
}

export function Microphone() {
  const { data: mic, error } = useMicrophone();
  const { data: vol } = useVolume();
  return (
    <Tile title="Mute">
      <div className="w-row w-gap">
        <button
          className={"w-toggle-btn" + (mic?.muted ? " active" : "")}
          disabled={!mic}
          onClick={async () => setShared("microphone", await api.toggleMicrophone())}
        >
          {mic?.muted ? "🎙️🚫" : "🎙️"}
          <span className="w-small">{mic ? (mic.muted ? "Mic muted" : "Mic on") : error ? "No mic" : "…"}</span>
        </button>
        <button
          className={"w-toggle-btn" + (vol?.muted ? " active" : "")}
          onClick={async () => setShared("volume", await api.toggleMute())}
        >
          {vol?.muted ? "🔇" : "🔊"}
          <span className="w-small">{vol?.muted ? "Sound muted" : "Sound on"}</span>
        </button>
      </div>
    </Tile>
  );
}
