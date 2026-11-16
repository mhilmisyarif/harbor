// Stock chart, stock watchlist and crypto.
import { useState } from "react";
import { api, StockResult } from "../lib/api";
import { Change, fmtPrice, Spark, Tile, useShared, WidgetProps } from "./kit";

function parseStock(r: StockResult) {
  const res = r.data?.chart.result?.[0];
  if (!res) return null;
  const price = res.meta.regularMarketPrice;
  const prev = res.meta.chartPreviousClose;
  const closes = (res.indicators.quote[0]?.close ?? []).filter((v): v is number => v !== null);
  return { price, change: prev ? ((price - prev) / prev) * 100 : 0, closes, currency: res.meta.currency };
}

const useStocks = (symbols: string[]) =>
  useShared(symbols.length ? `stocks:${symbols.join(",")}` : null, () => api.stocks(symbols), 60_000);

function SymbolForm({ value, onCommit, placeholder, many }: {
  value: string[];
  onCommit: (list: string[]) => void;
  placeholder: string;
  many: boolean;
}) {
  const [text, setText] = useState(value.join(", "));
  const commit = () => {
    const list = text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) onCommit(many ? list.slice(0, 8) : list.slice(0, 1));
  };
  return (
    <div className="w-form">
      <input
        className="w-input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <p className="w-muted w-small">{many ? "Comma-separated tickers." : "One ticker."} Press Enter to save.</p>
    </div>
  );
}

// ---------- Stock chart ----------

export interface SymbolSettings {
  symbol: string;
}

export function StockChart({ settings }: WidgetProps<SymbolSettings>) {
  const { data, error } = useStocks([settings.symbol]);
  const s = data?.[0] ? parseStock(data[0]) : null;
  return (
    <Tile title={settings.symbol}>
      {s ? (
        <>
          <div className="w-row">
            <span className="w-big">{fmtPrice(s.price)}</span>
            <Change pct={s.change} />
          </div>
          <Spark values={s.closes} height={44} trend={s.change} />
          <div className="w-muted w-small">Today · {s.currency}</div>
        </>
      ) : (
        <p className="w-muted">{data?.[0]?.error ?? error ?? "Loading…"}</p>
      )}
    </Tile>
  );
}

export const StockSymbolForm = ({ settings, setSettings }: WidgetProps<SymbolSettings>) => (
  <SymbolForm value={[settings.symbol]} many={false} placeholder="AAPL" onCommit={([symbol]) => setSettings({ symbol })} />
);

// ---------- Stock watchlist ----------

export interface ListSettings {
  symbols: string[];
}

export function StockWatchlist({ settings }: WidgetProps<ListSettings>) {
  const { data, error } = useStocks(settings.symbols);
  return (
    <Tile title="Watchlist">
      {(data ?? []).map((r) => {
        const s = parseStock(r);
        return (
          <div key={r.symbol} className="w-row">
            <b className="w-sym">{r.symbol}</b>
            {s ? (
              <>
                <span className="w-mini-spark">
                  <Spark values={s.closes} height={18} fill={false} trend={s.change} />
                </span>
                <span className="w-num">{fmtPrice(s.price)}</span>
                <Change pct={s.change} />
              </>
            ) : (
              <span className="w-muted">{r.error ?? "no data"}</span>
            )}
          </div>
        );
      })}
      {!data && <p className="w-muted">{error ?? "Loading…"}</p>}
    </Tile>
  );
}

export const WatchlistForm = ({ settings, setSettings }: WidgetProps<ListSettings>) => (
  <SymbolForm value={settings.symbols} many placeholder="AAPL, MSFT, ^GSPC" onCommit={(symbols) => setSettings({ symbols })} />
);

// ---------- Crypto ----------

export function Crypto({ settings }: WidgetProps<SymbolSettings>) {
  const sym = settings.symbol;
  const ticker = useShared(`crypto:${sym}`, () => api.crypto([sym]), 30_000);
  const chart = useShared(`crypto-chart:${sym}`, () => api.cryptoChart(sym), 5 * 60_000);
  const t = ticker.data?.[0];
  return (
    <Tile title={sym.replace(/(USDT|USDC|BUSD|USD)$/, "")}>
      {t ? (
        <>
          <div className="w-row">
            <span className="w-big">{fmtPrice(Number(t.lastPrice))}</span>
            <Change pct={Number(t.priceChangePercent)} />
          </div>
          <Spark values={chart.data ?? []} height={40} trend={Number(t.priceChangePercent)} />
          <div className="w-muted w-small">24h · Binance</div>
        </>
      ) : (
        <p className="w-muted">{ticker.error ?? "Loading…"}</p>
      )}
    </Tile>
  );
}

export const CryptoForm = ({ settings, setSettings }: WidgetProps<SymbolSettings>) => (
  <SymbolForm value={[settings.symbol]} many={false} placeholder="BTCUSDT" onCommit={([symbol]) => setSettings({ symbol })} />
);
