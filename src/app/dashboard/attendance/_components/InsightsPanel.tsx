"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { AttendanceInsightsResponse, Finding, FindingType } from "@/lib/attendance/ai-insights-types";

interface InsightsPanelProps {
  captureConfig: { ai_insights_enabled: boolean };
  allowedClassIds: string[];
  classes: { id: string; name: string; short_code: string }[];
}

function severityIcon(severity: Finding["severity"]): string {
  if (severity === "alert") return "🔴";
  if (severity === "warning") return "⚠️";
  return "ℹ️";
}

function typeBadgeClass(type: FindingType): string {
  switch (type) {
    case "data_quality_issue": return "bg-orange-100 text-orange-800 border border-orange-200";
    case "pattern": return "bg-blue-100 text-blue-800 border border-blue-200";
    case "suggestion": return "bg-green-100 text-green-800 border border-green-200";
    case "fact": return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

const TYPE_ORDER: FindingType[] = ["data_quality_issue", "pattern", "suggestion", "fact"];

function groupFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  );
}

function getDefaultDates(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return {
    from: from.toISOString().substring(0, 10),
    to: to.toISOString().substring(0, 10),
  };
}

export default function InsightsPanel({ captureConfig, allowedClassIds, classes }: InsightsPanelProps) {
  const defaults = getDefaultDates();
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState(allowedClassIds[0] ?? "");
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AttendanceInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!captureConfig.ai_insights_enabled) return null;

  const filteredClasses = classes.filter((c) => allowedClassIds.includes(c.id));

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/attendance/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: classId ? "class" : "school",
          class_id: classId || undefined,
          date_from: dateFrom,
          date_to: dateTo,
          capability: "all",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "An unexpected error occurred.");
      } else {
        setResult(data as AttendanceInsightsResponse);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const grouped = result ? groupFindings(result.findings) : [];

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-between w-full text-left"
        >
          <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span>✨</span> AI Attendance Insights
          </CardTitle>
          {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Class</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] min-w-[140px]"
              >
                <option value="">All classes</option>
                {filteredClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F2A47] text-white text-sm font-semibold hover:bg-[#1a3d6b] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? "Generating…" : "Generate Insights"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                <p className="text-sm text-blue-900">{result.summary}</p>
                <p className="text-[10px] text-blue-400 mt-1">
                  Generated {new Date(result.generated_at).toLocaleString()}
                </p>
              </div>

              {/* Findings */}
              {grouped.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No findings for this period.</p>
              )}
              {grouped.map((finding, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-1"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base leading-none">{severityIcon(finding.severity)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeBadgeClass(finding.type)}`}>
                      {finding.type.replace(/_/g, " ")}
                    </span>
                    {finding.display_name && (
                      <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                        {finding.display_name}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-gray-800">{finding.title}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{finding.detail}</p>
                  {finding.suggested_action && (
                    <p className="text-xs text-gray-400 italic">{finding.suggested_action}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
