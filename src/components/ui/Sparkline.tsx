"use client";

import { cn } from "@/lib/utils";

/**
 * Inline SVG sparkline for KPI cards. No dependencies. Draws a
 * smoothed line for the given series inside a fixed-width viewport.
 * Colors auto-invert on dark backgrounds via the `tone` prop.
 */
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  tone?: "navy" | "gold" | "emerald" | "red" | "amber" | "white";
  showArea?: boolean;
  className?: string;
}

const toneColors: Record<NonNullable<SparklineProps["tone"]>, { stroke: string; fill: string }> = {
  navy:    { stroke: "#0F2A47", fill: "rgba(15,42,71,0.12)" },
  gold:    { stroke: "#C9A227", fill: "rgba(201,162,39,0.18)" },
  emerald: { stroke: "#059669", fill: "rgba(5,150,105,0.15)" },
  red:     { stroke: "#dc2626", fill: "rgba(220,38,38,0.15)" },
  amber:   { stroke: "#d97706", fill: "rgba(217,119,6,0.15)" },
  white:   { stroke: "#ffffff", fill: "rgba(255,255,255,0.2)" },
};

export function Sparkline({
  data, width = 80, height = 28, strokeWidth = 1.75, tone = "navy", showArea = true, className,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className={cn("h-7", className)} style={{ width, height }} />;
  }
  const t = toneColors[tone];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const areaPath = `${path} L ${points[points.length - 1][0]} ${height - pad} L ${points[0][0]} ${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn("shrink-0", className)}>
      {showArea && <path d={areaPath} fill={t.fill} />}
      <path d={path} fill="none" stroke={t.stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2.5} fill={t.stroke} />
    </svg>
  );
}
