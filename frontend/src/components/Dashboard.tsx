import { useMemo, useState } from "react";
import {
  formatCurrency,
  formatPct,
  generateAllocation,
  generateBenchmarkSeries,
  generateDailyPnl,
  generateHoldings,
  generatePerformanceSeries,
  generateSectorWeights,
  portfolioSnapshot,
  todayLabel,
  type RangeKey,
} from "../data/mockPortfolio";
import LineChart, { BarChart, DonutChart, PnlChart, Sparkline } from "./charts/Charts";
import "./Dashboard.css";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "5d", label: "5D" },
  { key: "30d", label: "30D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
];

export default function Dashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const holdings = useMemo(() => generateHoldings(), []);
  const allocation = useMemo(() => generateAllocation(), []);
  const sectors = useMemo(() => generateSectorWeights(), []);

  const performance = useMemo(() => generatePerformanceSeries(range), [range]);
  const benchmark = useMemo(
    () => generateBenchmarkSeries(range, performance),
    [range, performance],
  );
  const dailyPnl = useMemo(() => generateDailyPnl(range), [range]);
  const snapshot = useMemo(() => portfolioSnapshot(performance), [performance]);

  const sectorBars = sectors.map((s) => ({
    label: s.sector,
    value: s.weight,
    color: "#6366f1",
  }));

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">Portfolio overview</p>
          <h1>Trading desk</h1>
          <p className="dashboard-date">As of {todayLabel()}</p>
        </div>
        <div className="dashboard-kpis">
          <div className="kpi">
            <span className="kpi-label">Total value</span>
            <span className="kpi-value">{formatCurrency(snapshot.totalValue)}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Today</span>
            <span className={`kpi-value ${snapshot.dayChange >= 0 ? "up" : "down"}`}>
              {formatCurrency(snapshot.dayChange)} ({formatPct(snapshot.dayChangePct)})
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">YTD</span>
            <span className={`kpi-value ${snapshot.ytdReturnPct >= 0 ? "up" : "down"}`}>
              {formatPct(snapshot.ytdReturnPct)}
            </span>
          </div>
        </div>
      </header>

      <section className="dashboard-card dashboard-card-wide">
        <div className="card-head">
          <h2>Performance</h2>
          <div className="range-toggle">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={range === r.key ? "active" : ""}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          <span><i className="dot portfolio" /> Portfolio</span>
          <span><i className="dot benchmark" /> S&P 500 (mock)</span>
        </div>
        <LineChart series={performance} compare={benchmark} height={220} />
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <h2>Asset allocation</h2>
          <div className="donut-row">
            <DonutChart slices={allocation} />
            <ul className="legend-list">
              {allocation.map((a) => (
                <li key={a.label}>
                  <span className="legend-swatch" style={{ background: a.color }} />
                  {a.label} — {a.value}%
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="dashboard-card">
          <h2>Sector exposure</h2>
          <BarChart data={sectorBars} height={180} />
          <ul className="sector-labels">
            {sectors.map((s) => (
              <li key={s.sector}>
                <span>{s.sector}</span>
                <span>{s.weight}%</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dashboard-card">
          <h2>Daily P&amp;L</h2>
          <p className="card-sub">Last {dailyPnl.length} sessions</p>
          <PnlChart data={dailyPnl} />
        </section>

        <section className="dashboard-card">
          <h2>Risk snapshot</h2>
          <div className="risk-grid">
            <div>
              <span className="risk-label">Beta</span>
              <span className="risk-value">1.12</span>
            </div>
            <div>
              <span className="risk-label">Sharpe (1Y)</span>
              <span className="risk-value">1.48</span>
            </div>
            <div>
              <span className="risk-label">Max drawdown</span>
              <span className="risk-value down">-8.4%</span>
            </div>
            <div>
              <span className="risk-label">Cash</span>
              <span className="risk-value">8.0%</span>
            </div>
          </div>
          <BarChart
            data={[
              { label: "VaR", value: 72, color: "#8b5cf6" },
              { label: "Vol", value: 58, color: "#6366f1" },
              { label: "Conc.", value: 41, color: "#a5b4fc" },
            ]}
            height={120}
          />
        </section>
      </div>

      <section className="dashboard-card">
        <h2>Holdings</h2>
        <div className="holdings-table-wrap">
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Day</th>
                <th>7d trend</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.symbol}>
                  <td className="symbol">{h.symbol}</td>
                  <td>{h.name}</td>
                  <td>{h.shares.toLocaleString()}</td>
                  <td>${h.price.toFixed(2)}</td>
                  <td className={h.changePct >= 0 ? "up" : "down"}>
                    {formatPct(h.changePct)}
                  </td>
                  <td>
                    <Sparkline values={h.sparkline} positive={h.changePct >= 0} />
                  </td>
                  <td>{formatCurrency(h.shares * h.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
