interface LineChartProps {
  series: { date: Date; value: number }[];
  compare?: { date: Date; value: number }[];
  height?: number;
}

function toPath(
  values: number[],
  width: number,
  height: number,
  pad = 8,
): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function LineChart({ series, compare, height = 200 }: LineChartProps) {
  const width = 600;
  const values = series.map((s) => s.value);
  const compareValues = compare?.map((s) => s.value);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" preserveAspectRatio="none">
      <path
        d={toPath(values, width, height)}
        fill="none"
        stroke="#6366f1"
        strokeWidth="2.5"
      />
      {compareValues && (
        <path
          d={toPath(compareValues, width, height)}
          fill="none"
          stroke="#71717a"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      )}
    </svg>
  );
}

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

export function BarChart({ data, height = 160 }: BarChartProps) {
  const width = 600;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = (width - 40) / data.length - 8;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 30);
        const x = 20 + i * (barW + 8);
        const y = height - 20 - h;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="4"
              fill={d.color ?? "#6366f1"}
            />
          </g>
        );
      })}
    </svg>
  );
}

interface PnlChartProps {
  data: { label: string; pnl: number }[];
  height?: number;
}

export function PnlChart({ data, height = 140 }: PnlChartProps) {
  const width = 600;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);
  const barW = (width - 40) / data.length - 6;
  const mid = height / 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" preserveAspectRatio="none">
      <line x1="10" y1={mid} x2={width - 10} y2={mid} stroke="#3f3f46" strokeWidth="1" />
      {data.map((d, i) => {
        const h = (Math.abs(d.pnl) / maxAbs) * (mid - 16);
        const x = 20 + i * (barW + 6);
        const y = d.pnl >= 0 ? mid - h : mid;
        return (
          <rect
            key={d.label}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx="3"
            fill={d.pnl >= 0 ? "#22c55e" : "#ef4444"}
          />
        );
      })}
    </svg>
  );
}

interface DonutProps {
  slices: { label: string; value: number; color: string }[];
  size?: number;
}

export function DonutChart({ slices, size = 140 }: DonutProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  let angle = -90;
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const ir = r * 0.55;

  const arcs = slices.map((slice) => {
    const sweep = (slice.value / total) * 360;
    const start = angle;
    angle += sweep;
    const end = angle;
    const large = sweep > 180 ? 1 : 0;

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(start));
    const y1 = cy + r * Math.sin(toRad(start));
    const x2 = cx + r * Math.cos(toRad(end));
    const y2 = cy + r * Math.sin(toRad(end));
    const ix1 = cx + ir * Math.cos(toRad(end));
    const iy1 = cy + ir * Math.sin(toRad(end));
    const ix2 = cx + ir * Math.cos(toRad(start));
    const iy2 = cy + ir * Math.sin(toRad(start));

    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${ir} ${ir} 0 ${large} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");

    return <path key={slice.label} d={d} fill={slice.color} />;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs}
    </svg>
  );
}

interface SparklineProps {
  values: number[];
  positive?: boolean;
}

export function Sparkline({ values, positive = true }: SparklineProps) {
  const w = 80;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="sparkline">
      <path d={d} fill="none" stroke={positive ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
    </svg>
  );
}
