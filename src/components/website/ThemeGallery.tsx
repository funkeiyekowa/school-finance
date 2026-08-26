"use client";

/**
 * Theme gallery — 6 families, 3 variants each.
 *
 * Families group themes that share structure (hero style, motif, section
 * rhythm) and differ only in palette. That distinction matters: switching
 * variant within a family is a safe recolour, switching family changes the
 * shape of the page.
 *
 * Each theme also ships AI image prompts so a school with no photography
 * can generate on-brand lifestyle imagery rather than shipping placeholders.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { motifBackground, motifSize } from "@/lib/website/theme";
import type { WebsiteTheme, ThemeFamily, LifestylePrompt } from "@/lib/website/types";
import {
  Check, Sparkles, Copy, Image as ImageIcon, Layers, Wand2, X, Info,
} from "lucide-react";

/* ------------------------------------------------------------------ */

export function ThemeGallery({
  themes, activeKey, onSelect, disabled, actionLabel = "Use this theme",
}: {
  themes: WebsiteTheme[];
  activeKey?: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
  actionLabel?: string;
}) {
  /* Group flat theme rows into families. Themes with no family (custom or
     legacy) fall into a synthetic "Other" family so nothing disappears. */
  const families: ThemeFamily[] = useMemo(() => {
    const map = new Map<string, ThemeFamily>();
    for (const t of themes) {
      const key = t.family ?? "other";
      if (!map.has(key)) {
        map.set(key, {
          family: key,
          label: t.family_label ?? "Other themes",
          sort_order: t.sort_order ?? 999,
          variants: [],
        });
      }
      map.get(key)!.variants.push(t);
    }
    const list = Array.from(map.values());
    list.forEach(fam => {
      fam.variants.sort((a, b) => (a.variant_order ?? 0) - (b.variant_order ?? 0));
    });
    return list.sort((a, b) => a.sort_order - b.sort_order);
  }, [themes]);

  /* Which variant is being shown for each family. Defaults to the active
     theme's variant when it belongs to that family, otherwise the first. */
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});

  const variantFor = (fam: ThemeFamily): WebsiteTheme => {
    const chosen = selectedVariant[fam.family];
    if (chosen) {
      const found = fam.variants.find(v => v.key === chosen);
      if (found) return found;
    }
    const activeInFamily = fam.variants.find(v => v.key === activeKey);
    return activeInFamily ?? fam.variants[0];
  };

  const [promptTheme, setPromptTheme] = useState<WebsiteTheme | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Info size={14} className="mt-px shrink-0" />
        <div>
          <strong>{themes.length} designs across {families.length} families.</strong>{" "}
          Variants within a family share layout and change only colour and type —
          switching variant is safe. Switching family changes the page structure,
          though your content is never lost either way.
        </div>
      </div>

      {families.map(fam => {
        const shown = variantFor(fam);
        const familyHasActive = fam.variants.some(v => v.key === activeKey);
        return (
          <section
            key={fam.family}
            className={cn(
              "rounded-2xl border overflow-hidden",
              familyHasActive ? "border-[#C9A227] ring-1 ring-[#C9A227]/30" : "border-gray-200"
            )}
          >
            {/* Family header */}
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <Layers size={15} className="text-gray-400 shrink-0" />
                <h3 className="font-bold text-sm text-[#0F2A47] truncate">{fam.label}</h3>
                {familyHasActive && <Badge variant="green">in use</Badge>}
                {shown.is_premium && <Badge variant="purple">premium</Badge>}
              </div>

              {/* Variant switcher */}
              <div
                className="flex items-center gap-1 p-1 bg-white rounded-lg border border-gray-200"
                role="tablist"
                aria-label={`${fam.label} variants`}
              >
                {fam.variants.map(v => {
                  const isShown = v.key === shown.key;
                  const swatch = v.tokens?.colors?.primary ?? "#ccc";
                  const swatchB = v.tokens?.colors?.accent ?? "#eee";
                  return (
                    <button
                      key={v.key}
                      role="tab"
                      aria-selected={isShown}
                      onClick={() => setSelectedVariant(s => ({ ...s, [fam.family]: v.key }))}
                      title={v.variant_label ?? v.name}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                        isShown ? "bg-[#0F2A47] text-white" : "text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-3 h-3 rounded-full shrink-0 border border-white/40"
                        style={{ background: `linear-gradient(135deg, ${swatch} 50%, ${swatchB} 50%)` }}
                      />
                      <span className="hidden sm:inline">{v.variant_label ?? "Variant"}</span>
                      {v.key === activeKey && <Check size={10} />}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* Preview + detail */}
            <div className="grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="border-b md:border-b-0 md:border-r border-gray-200">
                <ThemeMiniPreview theme={shown} height={200} />
              </div>

              <div className="p-4 flex flex-col gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#C9A227]">
                    {shown.variant_label}
                  </p>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    {shown.description}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <SpecRow label="Headings" value={shown.tokens?.fonts?.heading ?? "—"} />
                  <SpecRow label="Body" value={shown.tokens?.fonts?.body ?? "—"} />
                  <SpecRow label="Hero" value={shown.tokens?.heroStyle ?? "—"} />
                  <SpecRow label="Texture" value={shown.tokens?.motif ?? "none"} />
                  <SpecRow label="Edges" value={shown.tokens?.divider ?? "none"} />
                  <SpecRow label="Cards" value={shown.tokens?.cardStyle ?? "soft"} />
                </dl>

                {/* Palette */}
                <div className="flex gap-1" aria-hidden="true">
                  {["primary", "primaryDark", "secondary", "accent", "surface", "background"].map(k => (
                    <div
                      key={k}
                      title={k}
                      className="flex-1 h-6 rounded border border-black/5"
                      style={{ background: shown.tokens?.colors?.[k] ?? "#eee" }}
                    />
                  ))}
                </div>

                {/* Signature sections */}
                {(shown.signature_sections?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                      Signature blocks
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {shown.signature_sections!.map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {s.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={shown.key === activeKey ? "secondary" : "gold"}
                    onClick={() => onSelect(shown.key)}
                    disabled={disabled || shown.key === activeKey}
                    className="flex-1"
                  >
                    {shown.key === activeKey ? "Current theme" : actionLabel}
                  </Button>
                  {(shown.lifestyle_prompts?.length ?? 0) > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setPromptTheme(shown)}>
                      <Wand2 size={13} /> Images
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {promptTheme && (
        <ImagePromptModal theme={promptTheme} onClose={() => setPromptTheme(null)} />
      )}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-700 font-medium truncate capitalize">
        {value.replace(/-/g, " ")}
      </dd>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Mini preview                                                        */
/* ------------------------------------------------------------------ */

export function ThemeMiniPreview({ theme, height = 200 }: { theme: WebsiteTheme; height?: number }) {
  const t = theme.tokens ?? {};
  const c = t.colors ?? {};
  const primary = c.primary ?? "#0F2A47";
  const primaryDark = c.primaryDark ?? primary;
  const accent = c.accent ?? "#C9A227";
  const bg = c.background ?? "#fff";
  const surface = c.surface ?? "#f8fafc";
  const border = c.border ?? "#e2e8f0";
  const text = c.text ?? "#0f172a";
  const radius = t.radius?.md ?? "12px";
  const btnRadius = t.button?.radius ?? radius;
  const motifImg = motifBackground(t.motif ?? "none", alpha(accent, 0.16));
  const darkHeader = t.headerStyle === "dark";
  const heroStyle = t.heroStyle ?? "image-right";
  const heroDark = ["badge-ring", "gradient", "centered", "full-bleed"].includes(heroStyle);
  const heroBg = heroDark
    ? (heroStyle === "gradient"
      ? `radial-gradient(circle at 72% 18%, ${alpha(accent, 0.35)}, transparent 62%), ${primary}`
      : primary)
    : surface;

  return (
    <div
      aria-hidden="true"
      style={{ height, background: bg, overflow: "hidden", position: "relative", fontSize: 0 }}
    >
      {/* Header */}
      <div style={{
        height: 22, background: darkHeader ? primary : bg,
        borderBottom: `1px solid ${darkHeader ? "transparent" : border}`,
        display: "flex", alignItems: "center", gap: 5, padding: "0 10px",
      }}>
        <div style={{ width: 9, height: 9, borderRadius: 2, background: accent }} />
        <div style={{ width: 30, height: 3.5, borderRadius: 2, background: darkHeader ? "rgba(255,255,255,.7)" : text, opacity: darkHeader ? 1 : 0.75 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 11, height: 2.5, borderRadius: 1, background: darkHeader ? "rgba(255,255,255,.5)" : text, opacity: darkHeader ? 1 : 0.45 }} />
          ))}
          <div style={{ width: 20, height: 9, borderRadius: btnRadius, background: accent }} />
        </div>
      </div>

      {/* Hero */}
      <div style={{
        height: heroStyle === "centered" || heroStyle === "full-bleed" ? 88 : 78,
        position: "relative", background: heroBg,
        backgroundImage: motifImg !== "none" ? motifImg : undefined,
        backgroundSize: motifSize(t.motif ?? "none"),
        padding: "12px 12px",
        display: "flex", alignItems: "center", gap: 10,
        clipPath: t.divider === "angle" ? "polygon(0 0,100% 0,100% 88%,0 100%)" : undefined,
      }}>
        <div style={{
          flex: 1, minWidth: 0,
          textAlign: heroStyle === "centered" ? "center" : "left",
        }}>
          <div style={{
            width: 24, height: 2.5, background: accent, marginBottom: 6,
            marginInline: heroStyle === "centered" ? "auto" : undefined,
          }} />
          <div style={{
            width: heroStyle === "centered" ? "80%" : "88%", height: 8, borderRadius: 2,
            background: heroDark ? "#fff" : text, opacity: 0.92, marginBottom: 4,
            marginInline: heroStyle === "centered" ? "auto" : undefined,
          }} />
          <div style={{
            width: heroStyle === "centered" ? "58%" : "62%", height: 8, borderRadius: 2,
            background: heroDark ? "#fff" : text, opacity: 0.92, marginBottom: 6,
            marginInline: heroStyle === "centered" ? "auto" : undefined,
          }} />
          <div style={{
            width: "50%", height: 4, borderRadius: 2,
            background: heroDark ? "rgba(255,255,255,.62)" : text, opacity: heroDark ? 1 : 0.45,
            marginBottom: 10, marginInline: heroStyle === "centered" ? "auto" : undefined,
          }} />
          <div style={{
            display: "flex", gap: 5,
            justifyContent: heroStyle === "centered" ? "center" : "flex-start",
          }}>
            <div style={{ width: 46, height: 14, borderRadius: btnRadius, background: accent }} />
            <div style={{
              width: 40, height: 14, borderRadius: btnRadius,
              border: `1.5px solid ${heroDark ? "rgba(255,255,255,.6)" : text}`,
            }} />
          </div>
        </div>

        {heroStyle === "badge-ring" && (
          <div style={{
            width: 54, height: 54, borderRadius: "50%", flexShrink: 0,
            border: `2px solid ${accent}`, display: "grid", placeItems: "center",
            fontSize: 15, fontWeight: 800, color: accent,
            fontFamily: "Georgia, serif",
            boxShadow: `0 0 0 8px ${alpha("#ffffff", 0.06)}`,
          }}>GS</div>
        )}
        {(heroStyle === "image-right" || heroStyle === "split-diagonal") && (
          <div style={{
            width: 74, height: 56, borderRadius: radius, flexShrink: 0,
            background: `linear-gradient(135deg, ${alpha(accent, 0.30)}, ${alpha(primary, 0.22)})`,
            border: `1px solid ${border}`,
          }} />
        )}
      </div>

      {/* Curve divider */}
      {t.divider === "curve" && (
        <svg viewBox="0 0 100 6" preserveAspectRatio="none"
          style={{ display: "block", width: "100%", height: 12, marginTop: -1 }}>
          <path d="M0,0 L100,0 L100,2 Q50,6 0,2 Z" fill={heroBg.includes("gradient") ? primary : heroBg} />
        </svg>
      )}

      {/* Marquee strip */}
      {t.marquee && (
        <div style={{
          height: 14, background: primaryDark, display: "flex", alignItems: "center",
          gap: 8, padding: "0 10px", overflow: "hidden",
        }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
              <div style={{ width: 3, height: 3, borderRadius: "50%", background: accent }} />
              <div style={{ width: 26, height: 2, borderRadius: 1, background: alpha(accent, 0.6) }} />
            </div>
          ))}
        </div>
      )}

      {/* Cards row */}
      <div style={{ display: "flex", gap: 6, padding: "12px 12px 0" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: 44, borderRadius: radius, background: bg,
            border: t.cardStyle === "flat" ? "none" : `1px solid ${border}`,
            boxShadow: t.cardStyle === "elevated" ? "0 3px 10px rgba(0,0,0,.10)"
              : t.cardStyle === "glass" ? `0 0 0 1px ${alpha(accent, 0.30)}`
              : t.cardStyle === "soft" ? "0 1px 4px rgba(0,0,0,.06)" : "none",
            padding: 6,
          }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: alpha(primary, 0.16), marginBottom: 5 }} />
            <div style={{ width: "78%", height: 2.5, background: text, opacity: 0.4, borderRadius: 1, marginBottom: 3 }} />
            <div style={{ width: "56%", height: 2.5, background: text, opacity: 0.25, borderRadius: 1 }} />
          </div>
        ))}
      </div>

      {/* Stats band hint */}
      <div style={{
        marginTop: 10, height: 26, background: primary,
        backgroundImage: motifImg !== "none" ? motifImg : undefined,
        backgroundSize: motifSize(t.motif ?? "none"),
        display: "flex", alignItems: "center", justifyContent: "space-around",
      }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ width: 16, height: 5, borderRadius: 1, background: accent, marginBottom: 2 }} />
            <div style={{ width: 20, height: 2, borderRadius: 1, background: "rgba(255,255,255,.5)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function alpha(hex: string, a: number): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  if (full.length !== 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------------------------ */
/* Image prompt library                                               */
/* ------------------------------------------------------------------ */

function ImagePromptModal({ theme, onClose }: { theme: WebsiteTheme; onClose: () => void }) {
  const prompts: LifestylePrompt[] = theme.lifestyle_prompts ?? [];
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, slot: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(slot);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* Clipboard unavailable — the text is selectable as a fallback. */
    }
  }

  return (
    <Modal open onClose={onClose} title={`Image prompts · ${theme.name}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FBF6E8] border border-[#C9A227] text-xs text-[#0F2A47]">
          <Sparkles size={14} className="mt-px shrink-0 text-[#C9A227]" />
          <div>
            Paste any of these into an image generator to produce photography that
            matches this theme&apos;s palette and mood. Replace the school details with
            your own before generating, then upload the result under{" "}
            <strong>Media</strong> and pick it in the relevant section.
          </div>
        </div>

        <ul className="space-y-3 list-none p-0 m-0">
          {prompts.map(p => (
            <li key={p.slot} className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-600">
                  <ImageIcon size={12} /> {p.slot.replace(/_/g, " ")}
                </span>
                <button
                  onClick={() => copy(p.prompt, p.slot)}
                  className="inline-flex items-center gap-1 text-xs text-[#0F2A47] hover:underline"
                >
                  {copied === p.slot
                    ? <><Check size={11} /> Copied</>
                    : <><Copy size={11} /> Copy</>}
                </button>
              </div>
              <p className="px-4 py-3 text-sm text-gray-700 leading-relaxed select-all">
                {p.prompt}
              </p>
            </li>
          ))}
        </ul>

        {prompts.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            This theme has no image prompts yet.
          </p>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
