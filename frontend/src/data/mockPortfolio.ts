export type RangeKey = "5d" | "30d" | "1m" | "1y";

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  changePct: number;
  sector: string;
  sparkline: number[];
}

export interface PortfolioSnapshot {
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
  ytdReturnPct: number;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function rangeDays(key: RangeKey): number {
  if (key === "5d") return 5;
  if (key === "30d") return 30;
  if (key === "1m") return 30;
  return 365;
}

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function generatePerformanceSeries(range: RangeKey): { date: Date; value: number }[] {
  const days = rangeDays(range);
  const rand = seeded(days * 17 + range.length);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let value = 1_000_000;
  const points: { date: Date; value: number }[] = [];

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const drift = 0.0008 + (rand() - 0.48) * 0.018;
    value *= 1 + drift;
    points.push({ date, value: Math.round(value * 100) / 100 });
  }

  return points;
}

export function generateBenchmarkSeries(
  range: RangeKey,
  portfolio: { date: Date; value: number }[],
): { date: Date; value: number }[] {
  const rand = seeded(42 + rangeDays(range));
  const start = portfolio[0]?.value ?? 1_000_000;
  let value = start * 0.97;
  return portfolio.map((p, i) => {
    if (i > 0) {
      value *= 1 + (rand() - 0.5) * 0.012;
    }
    return { date: p.date, value: Math.round(value * 100) / 100 };
  });
}

export function generateDailyPnl(range: RangeKey): { label: string; pnl: number }[] {
  const days = Math.min(rangeDays(range), 14);
  const rand = seeded(99);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - i));
    const pnl = Math.round((rand() - 0.42) * 18000);
    return { label: shortDate(date), pnl };
  });
}

export function generateSectorWeights(): { sector: string; weight: number }[] {
  return [
    { sector: "Technology", weight: 38 },
    { sector: "Healthcare", weight: 16 },
    { sector: "Financials", weight: 14 },
    { sector: "Consumer", weight: 12 },
    { sector: "Energy", weight: 9 },
    { sector: "Industrials", weight: 7 },
    { sector: "Other", weight: 4 },
  ];
}

export function generateAllocation(): { label: string; value: number; color: string }[] {
  return [
    { label: "US Equities", value: 62, color: "#6366f1" },
    { label: "Intl Equities", value: 18, color: "#8b5cf6" },
    { label: "Fixed Income", value: 12, color: "#22c55e" },
    { label: "Cash", value: 8, color: "#71717a" },
  ];
}

function sparkline(seed: number, len = 12): number[] {
  const rand = seeded(seed);
  let v = 100;
  return Array.from({ length: len }, () => {
    v *= 1 + (rand() - 0.5) * 0.04;
    return Math.round(v * 10) / 10;
  });
}

export function generateHoldings(): Holding[] {
  const base = [
    { symbol: "NVDA", name: "NVIDIA Corp", shares: 420, price: 892.4, changePct: 2.14, sector: "Technology" },
    { symbol: "AAPL", name: "Apple Inc", shares: 1850, price: 198.3, changePct: -0.42, sector: "Technology" },
    { symbol: "MSFT", name: "Microsoft", shares: 960, price: 428.7, changePct: 0.88, sector: "Technology" },
    { symbol: "JPM", name: "JPMorgan Chase", shares: 640, price: 198.1, changePct: 1.05, sector: "Financials" },
    { symbol: "UNH", name: "UnitedHealth", shares: 310, price: 512.6, changePct: -0.31, sector: "Healthcare" },
    { symbol: "XOM", name: "Exxon Mobil", shares: 880, price: 114.2, changePct: 0.67, sector: "Energy" },
  ];

  return base.map((h, i) => ({
    ...h,
    sparkline: sparkline(i * 13 + 7),
  }));
}

export function portfolioSnapshot(series: { value: number }[]): PortfolioSnapshot {
  const totalValue = series[series.length - 1]?.value ?? 0;
  const prev = series[series.length - 2]?.value ?? totalValue;
  const dayChange = totalValue - prev;
  const dayChangePct = prev ? (dayChange / prev) * 100 : 0;

  const yearStart = new Date();
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const ytdIndex = Math.max(0, series.length - Math.min(series.length, 90));
  const ytdBase = series[ytdIndex]?.value ?? series[0]?.value ?? totalValue;
  const ytdReturnPct = ytdBase ? ((totalValue - ytdBase) / ytdBase) * 100 : 0;

  return {
    totalValue,
    dayChange,
    dayChangePct,
    ytdReturnPct,
  };
}

export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
