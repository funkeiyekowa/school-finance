"use client";

import { useMemo } from "react";
import { resolveTheme, googleFontsHref } from "@/lib/website/theme";
import { COLOR_ROLES } from "@/lib/website/theme";
import type { WebsiteTheme } from "@/lib/website/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Download, Copy } from "lucide-react";

interface BrandKitProps {
  site: {
    site_name: string;
    logo_url: string | null;
    brand: Record<string, unknown>;
    typography: Record<string, string>;
  };
  theme: WebsiteTheme | undefined;
}

export function BrandKit({ site, theme }: BrandKitProps) {
  const resolved = useMemo(
    () => resolveTheme(theme, { brand: site.brand as never, typography: site.typography }),
    [theme, site.brand, site.typography]
  );

  const fontsUrl = useMemo(() => googleFontsHref(resolved), [resolved]);

  function copyColor(hex: string) {
    navigator.clipboard?.writeText(hex);
  }

  function exportKit() {
    const kit = {
      name: site.site_name,
      logo: site.logo_url,
      colors: resolved.colors,
      fonts: resolved.fonts,
      scale: resolved.scale,
      radius: resolved.radius,
      spacing: resolved.spacing,
      button: resolved.button,
      shadow: resolved.shadow,
      googleFontsUrl: fontsUrl,
    };
    const blob = new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${site.site_name.replace(/\s+/g, "-").toLowerCase()}-brand-kit.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Brand Kit</CardTitle>
            <Button size="sm" variant="secondary" onClick={exportKit}>
              <Download size={14} /> Export JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-gray-600">
            A summary of your school&apos;s visual identity. Share this with designers,
            print vendors, or anyone who needs to stay on-brand.
          </p>

          {site.logo_url && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Logo</h4>
              <div className="inline-flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={site.logo_url}
                  alt={`${site.site_name} logo`}
                  className="h-16 w-auto object-contain"
                />
                <div className="text-xs text-gray-500">
                  <p className="font-medium text-gray-700">{site.site_name}</p>
                  <p className="mt-1 break-all max-w-xs">{site.logo_url}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Typography
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["heading", "body", "accent"] as const).map(slot => (
                <div key={slot} className="p-3 border border-gray-200 rounded-lg">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    {slot}
                  </p>
                  <p
                    className="text-lg font-semibold text-[#0F2A47]"
                    style={{ fontFamily: resolved.fonts[slot] }}
                  >
                    {resolved.fonts[slot]}
                  </p>
                  <p
                    className="text-sm text-gray-600 mt-1"
                    style={{ fontFamily: resolved.fonts[slot] }}
                  >
                    The quick brown fox jumps over the lazy dog
                  </p>
                </div>
              ))}
            </div>
            {fontsUrl && (
              <p className="text-[10px] text-gray-400 mt-2 break-all">
                Google Fonts: {fontsUrl}
              </p>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Colour palette
            </h4>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
              {COLOR_ROLES.map(role => {
                const hex = resolved.colors[role.key] ?? "";
                return (
                  <button
                    key={role.key}
                    onClick={() => copyColor(hex)}
                    className="group text-left"
                    title={`Click to copy ${hex}`}
                  >
                    <div
                      className="w-full aspect-square rounded-lg border border-gray-200 mb-1 group-hover:ring-2 ring-[#C9A227] transition-shadow"
                      style={{ background: hex }}
                    />
                    <p className="text-[10px] font-medium text-gray-700 truncate">{role.label}</p>
                    <p className="text-[10px] font-mono text-gray-400 flex items-center gap-0.5">
                      {hex}
                      <Copy size={8} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Shape &amp; spacing
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TokenGroup label="Border radius" tokens={resolved.radius} />
              <TokenGroup label="Spacing" tokens={resolved.spacing} />
              <TokenGroup label="Type scale" tokens={resolved.scale} />
              <TokenGroup label="Button" tokens={resolved.button} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TokenGroup({ label, tokens }: { label: string; tokens: Record<string, string> }) {
  return (
    <div className="p-3 border border-gray-200 rounded-lg">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
      <dl className="space-y-1">
        {Object.entries(tokens).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <dt className="text-gray-600">{k}</dt>
            <dd className="font-mono text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
