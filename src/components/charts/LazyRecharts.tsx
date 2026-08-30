"use client";

/**
 * Lazy-load Recharts.
 *
 * Recharts is ~350 KB minified. Every dashboard page that renders a
 * chart was pulling that into the initial JS bundle. This wrapper
 * defers the whole library until the browser is idle (or the chart
 * enters view), swapping the imports with a light skeleton in the
 * meantime.
 *
 * Import chart primitives from THIS file instead of "recharts":
 *
 *   import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from "@/components/charts/LazyRecharts";
 *
 * The public API mirrors Recharts 1:1 for the primitives the app uses,
 * so callers change one line and get the perf win.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/* Small placeholder while the library ships over the wire. */
function Skeleton() {
  return <div className="w-full h-full rounded-lg bg-gray-100 animate-pulse" style={{ minHeight: 200 }} />;
}

const wrap = <T extends ComponentType<any>>(name: string): T => {
  return dynamic(
    () => import("recharts").then((mod) => (mod as unknown as Record<string, T>)[name]),
    { ssr: false, loading: () => <Skeleton /> },
  ) as unknown as T;
};

const wrapNoLoader = <T extends ComponentType<any>>(name: string): T => {
  return dynamic(
    () => import("recharts").then((mod) => (mod as unknown as Record<string, T>)[name]),
    { ssr: false, loading: () => null },
  ) as unknown as T;
};

/* Container-level components render a skeleton so users see something. */
export const ResponsiveContainer = wrap("ResponsiveContainer");
export const LineChart = wrap("LineChart");
export const BarChart = wrap("BarChart");
export const AreaChart = wrap("AreaChart");
export const PieChart = wrap("PieChart");
export const ComposedChart = wrap("ComposedChart");
export const RadarChart = wrap("RadarChart");

/* Leaf primitives — no skeleton, they live inside a chart. */
export const Line = wrapNoLoader("Line");
export const Bar = wrapNoLoader("Bar");
export const Area = wrapNoLoader("Area");
export const Pie = wrapNoLoader("Pie");
export const Cell = wrapNoLoader("Cell");
export const XAxis = wrapNoLoader("XAxis");
export const YAxis = wrapNoLoader("YAxis");
export const CartesianGrid = wrapNoLoader("CartesianGrid");
export const Tooltip = wrapNoLoader("Tooltip");
export const Legend = wrapNoLoader("Legend");
export const RadialBar = wrapNoLoader("RadialBar");
export const RadialBarChart = wrapNoLoader("RadialBarChart");
export const PolarAngleAxis = wrapNoLoader("PolarAngleAxis");
export const PolarGrid = wrapNoLoader("PolarGrid");
export const PolarRadiusAxis = wrapNoLoader("PolarRadiusAxis");
export const Radar = wrapNoLoader("Radar");
export const ReferenceLine = wrapNoLoader("ReferenceLine");
export const Brush = wrapNoLoader("Brush");
export const LabelList = wrapNoLoader("LabelList");
