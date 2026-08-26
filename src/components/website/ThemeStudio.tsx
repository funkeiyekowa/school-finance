"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { COLOR_ROLES, FONT_LIBRARY } from "@/lib/website/theme";
import { ContrastChecker } from "@/components/website/ContrastChecker";
import { CustomThemeManager } from "@/components/website/CustomThemeEditor";
import { DevicePreview } from "@/components/website/DevicePreview";
import { validateThemeTokens } from "@/lib/website/theme-validator";
import { loadDraft, saveDraft, publishDraft, discardDraft, draftDiffersFromPublished } from "@/lib/website/draft";
import type { DraftState, SaveDraftParams } from "@/lib/website/draft";
import type { CustomTheme, WebsiteTheme, ThemeTokens } from "@/lib/website/types";
import { ThemeGallery } from "@/components/website/ThemeGallery";
import {
  Palette, Type, Undo2, Upload as UploadIcon, Rocket,
  Monitor, RefreshCw, Download,
  Circle, Square, Layers, SlidersHorizontal, Info, LayoutTemplate,
} from "lucide-react";

interface SiteRow {
  id: string;
  organization_id: string;
  theme_key: string;
  custom_theme_id?: string | null;
  site_name: string;
  brand: Record<string, unknown>;
  typography: Record<string, string>;
}

interface ThemeStudioProps {
  supabase: SupabaseClient;
  site: SiteRow;
  themes: WebsiteTheme[];
  customThemes: CustomTheme[];
  previewPath: string;
  isAdmin: boolean;
  onSiteUpdate: () => Promise<void>;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
}

type Panel = "gallery" | "colors" | "typography" | "shape" | "contrast" | "custom";

const PANELS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: "gallery", label: "Themes", icon: <Palette size={13} /> },
  { id: "colors", label: "Colours", icon: <Circle size={13} /> },
  { id: "typography", label: "Typography", icon: <Type size={13} /> },
  { id: "shape", label: "Shape & Space", icon: <Square size={13} /> },
  { id: "contrast", label: "Contrast", icon: <Layers size={13} /> },
  { id: "custom", label: "My Themes", icon: <SlidersHorizontal size={13} /> },
];

const AUTOSAVE_DELAY = 1500;

/**
 * Strip empty token groups so a stored value compares equal to freshly
 * built editor state. Without this, {} and {colors:{}} look different.
 */
function normaliseTokens(raw: unknown): ThemeTokens {
  const t = (raw ?? {}) as Record<string, unknown>;
  const out: ThemeTokens = {};
  const groups = ["colors", "scale", "radius", "spacing", "button", "shadow"] as const;
  for (const g of groups) {
    const v = t[g] as Record<string, string> | undefined;
    if (v && Object.keys(v).some(k => v[k])) {
      out[g] = Object.fromEntries(Object.entries(v).filter(([, x]) => x)) as Record<string, string>;
    }
  }
  if (typeof t.headerStyle === "string" && t.headerStyle) out.headerStyle = t.headerStyle;
  if (typeof t.heroStyle === "string" && t.heroStyle) out.heroStyle = t.heroStyle;
  if (typeof t.motif === "string" && t.motif) out.motif = t.motif;
  if (typeof t.divider === "string" && t.divider) out.divider = t.divider;
  if (typeof t.cardStyle === "string" && t.cardStyle) out.cardStyle = t.cardStyle;
  return out;
}

export function ThemeStudio({
  supabase, site, themes, customThemes, previewPath, isAdmin, onSiteUpdate, flash, setError,
}: ThemeStudioProps) {
  const [panel, setPanel] = useState<Panel>("gallery");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  // Working state (local edits that haven't been saved to draft yet)
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [customThemeId, setCustomThemeId] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<Record<string, string>>({});
  const [scale, setScale] = useState<Record<string, string>>({});
  const [radius, setRadius] = useState<Record<string, string>>({});
  const [spacing, setSpacing] = useState<Record<string, string>>({});
  const [button, setButton] = useState<Record<string, string>>({});
  const [shadow, setShadow] = useState<Record<string, string>>({});
  const [headerStyle, setHeaderStyle] = useState<string>("");
  const [heroStyle, setHeroStyle] = useState<string>("");

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // Load draft on mount
  useEffect(() => {
    (async () => {
      const d = await loadDraft(supabase);
      if (d) {
        setDraft(d);
        setThemeKey(d.theme_key);
        setCustomThemeId(d.custom_theme_id);
        setColors((d.brand as ThemeTokens)?.colors ?? {});
        setFonts(d.typography ?? {});
        setScale((d.brand as ThemeTokens)?.scale ?? {});
        setRadius((d.brand as ThemeTokens)?.radius ?? {});
        setSpacing((d.brand as ThemeTokens)?.spacing ?? {});
        setButton((d.brand as ThemeTokens)?.button ?? {});
        setShadow((d.brand as ThemeTokens)?.shadow ?? {});
        setHeaderStyle((d.brand as ThemeTokens)?.headerStyle ?? "");
        setHeroStyle((d.brand as ThemeTokens)?.heroStyle ?? "");
      } else {
        // No draft exists — initialize from published state
        setThemeKey(site.theme_key);
        setCustomThemeId(site.custom_theme_id ?? null);
        const brand = (site.brand ?? {}) as ThemeTokens;
        setColors(brand.colors ?? {});
        setFonts(site.typography ?? {});
        setScale(brand.scale ?? {});
        setRadius(brand.radius ?? {});
        setSpacing(brand.spacing ?? {});
        setButton(brand.button ?? {});
        setShadow(brand.shadow ?? {});
        setHeaderStyle(brand.headerStyle ?? "");
        setHeroStyle(brand.heroStyle ?? "");
      }
      setDraftLoaded(true);
    })();
  }, [supabase, site]);

  // Resolved theme for preview
  const activeTheme = useMemo(() => {
    if (customThemeId) {
      const ct = customThemes.find(t => t.id === customThemeId);
      if (ct) return { key: "custom", name: ct.name, tokens: ct.tokens } as WebsiteTheme;
    }
    return themes.find(t => t.key === themeKey) ?? themes[0];
  }, [themeKey, customThemeId, themes, customThemes]);

  const resolvedColors = useMemo(() => {
    const base = activeTheme?.tokens?.colors ?? {};
    return { ...base, ...Object.fromEntries(Object.entries(colors).filter(([, v]) => v)) };
  }, [activeTheme, colors]);

  /**
   * Autosave needs the CURRENT editor state, not the state from the render
   * that created the callback. A ref mirrors state every render so the
   * debounced timer always reads live values.
   *
   * This previously used useCallback with an empty dependency array, which
   * captured the first render — before the mount effect had hydrated
   * anything. Every autosave therefore wrote nulls and empty objects, so a
   * theme selection never survived, and Publish promoted an empty draft.
   */
  const stateRef = useRef({
    themeKey, customThemeId, colors, fonts, scale, radius,
    spacing, button, shadow, headerStyle, heroStyle, draftLoaded,
  });
  useEffect(() => {
    stateRef.current = {
      themeKey, customThemeId, colors, fonts, scale, radius,
      spacing, button, shadow, headerStyle, heroStyle, draftLoaded,
    };
  }, [themeKey, customThemeId, colors, fonts, scale, radius,
      spacing, button, shadow, headerStyle, heroStyle, draftLoaded]);

  /** Guards re-entrancy without relying on the `saving` state closure. */
  const savingRef = useRef(false);

  const doSave = useCallback(async () => {
    // Never write before the mount effect has loaded real values, otherwise
    // we would overwrite a good draft with blanks.
    if (!stateRef.current.draftLoaded) return;
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);

    const s = stateRef.current;
    const brand: ThemeTokens = {};
    if (Object.keys(s.colors).some(k => s.colors[k])) brand.colors = s.colors;
    if (Object.keys(s.scale).some(k => s.scale[k])) brand.scale = s.scale;
    if (Object.keys(s.radius).some(k => s.radius[k])) brand.radius = s.radius;
    if (Object.keys(s.spacing).some(k => s.spacing[k])) brand.spacing = s.spacing;
    if (Object.keys(s.button).some(k => s.button[k])) brand.button = s.button;
    if (Object.keys(s.shadow).some(k => s.shadow[k])) brand.shadow = s.shadow;
    if (s.headerStyle) brand.headerStyle = s.headerStyle;
    if (s.heroStyle) brand.heroStyle = s.heroStyle;

    const params: SaveDraftParams = {
      themeKey: s.themeKey ?? undefined,
      customThemeId: s.customThemeId ?? undefined,
      brand,
      typography: s.fonts,
    };

    const result = await saveDraft(supabase, params);
    savingRef.current = false;
    setSaving(false);
    if (result.ok) {
      dirtyRef.current = false;
      setLastSaved(new Date().toLocaleTimeString());
    } else {
      setError(result.error ?? "Failed to save draft");
    }
  }, [supabase, setError]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { doSave(); }, AUTOSAVE_DELAY);
  }, [doSave]);

  /** Write immediately, used before previewing so the iframe sees the change. */
  const saveNow = useCallback(async () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    await doSave();
  }, [doSave]);

  // Flush any pending autosave when leaving the tab.
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        if (dirtyRef.current) doSave();
      }
    };
  }, [doSave]);

  function updateColor(key: string, value: string) {
    setColors(c => ({ ...c, [key]: value }));
    scheduleSave();
  }

  function updateFont(slot: string, value: string) {
    setFonts(f => ({ ...f, [slot]: value }));
    scheduleSave();
  }

  function updateScale(key: string, value: string) {
    setScale(s => ({ ...s, [key]: value }));
    scheduleSave();
  }

  function updateRadius(key: string, value: string) {
    setRadius(r => ({ ...r, [key]: value }));
    scheduleSave();
  }

  function updateSpacing(key: string, value: string) {
    setSpacing(s => ({ ...s, [key]: value }));
    scheduleSave();
  }

  function updateButton(key: string, value: string) {
    setButton(b => ({ ...b, [key]: value }));
    scheduleSave();
  }

  function updateShadow(key: string, value: string) {
    setShadow(s => ({ ...s, [key]: value }));
    scheduleSave();
  }

  function selectTheme(key: string) {
    setThemeKey(key);
    setCustomThemeId(null);
    scheduleSave();
  }

  function selectCustomTheme(id: string) {
    setCustomThemeId(id);
    setThemeKey(null);
    scheduleSave();
  }

  async function handleDiscard() {
    const result = await discardDraft(supabase);
    if (result.ok) {
      flash("Draft discarded. Reverted to published state.");
      // Reload draft state
      const d = await loadDraft(supabase);
      if (d) {
        setDraft(d);
        setThemeKey(d.theme_key);
        setCustomThemeId(d.custom_theme_id);
        setColors((d.brand as ThemeTokens)?.colors ?? {});
        setFonts(d.typography ?? {});
        setScale((d.brand as ThemeTokens)?.scale ?? {});
        setRadius((d.brand as ThemeTokens)?.radius ?? {});
        setSpacing((d.brand as ThemeTokens)?.spacing ?? {});
        setButton((d.brand as ThemeTokens)?.button ?? {});
        setShadow((d.brand as ThemeTokens)?.shadow ?? {});
        setHeaderStyle((d.brand as ThemeTokens)?.headerStyle ?? "");
        setHeroStyle((d.brand as ThemeTokens)?.heroStyle ?? "");
      }
    } else {
      setError(result.error ?? "Failed to discard draft");
    }
  }

  async function handlePublish() {
    setPublishing(true);
    const result = await publishDraft(supabase);
    setPublishing(false);
    setShowPublishConfirm(false);
    if (result.ok) {
      flash("Published! Your changes are now live.");
      setLastSaved(null);
      await onSiteUpdate();
    } else {
      setError(result.error ?? "Publish failed");
    }
  }

  /**
   * Does the editor state differ from what is published?
   *
   * The brand object MUST be assembled exactly as doSave assembles it —
   * omitting empty groups. Building it with every key always present made
   * the comparison asymmetric against the stored value, so the badge read
   * "Unpublished changes" permanently.
   */
  const hasUnpublished = useMemo(() => {
    if (!draftLoaded) return false;

    const brand: ThemeTokens = {};
    if (Object.keys(colors).some(k => colors[k])) brand.colors = colors;
    if (Object.keys(scale).some(k => scale[k])) brand.scale = scale;
    if (Object.keys(radius).some(k => radius[k])) brand.radius = radius;
    if (Object.keys(spacing).some(k => spacing[k])) brand.spacing = spacing;
    if (Object.keys(button).some(k => button[k])) brand.button = button;
    if (Object.keys(shadow).some(k => shadow[k])) brand.shadow = shadow;
    if (headerStyle) brand.headerStyle = headerStyle;
    if (heroStyle) brand.heroStyle = heroStyle;

    // Typography: drop empty slots so {} and {heading:""} compare equal.
    const typo = Object.fromEntries(
      Object.entries(fonts).filter(([, v]) => v)
    ) as Record<string, string>;

    return draftDiffersFromPublished(
      {
        theme_key: themeKey,
        custom_theme_id: customThemeId,
        brand,
        typography: typo,
        last_saved_at: null,
        saved_by: null,
        published_at: null,
      },
      {
        theme_key: site.theme_key,
        custom_theme_id: site.custom_theme_id ?? null,
        brand: normaliseTokens(site.brand),
        typography: Object.fromEntries(
          Object.entries(site.typography ?? {}).filter(([, v]) => v)
        ) as Record<string, string>,
      }
    );
  }, [draftLoaded, themeKey, customThemeId, colors, fonts, scale, radius, spacing, button, shadow, headerStyle, heroStyle, site]);

  function exportTheme() {
    const tokens: ThemeTokens = {
      colors: Object.keys(colors).length > 0 ? colors : undefined,
      fonts: Object.keys(fonts).length > 0 ? fonts as ThemeTokens["fonts"] : undefined,
      scale: Object.keys(scale).length > 0 ? scale : undefined,
      radius: Object.keys(radius).length > 0 ? radius : undefined,
      spacing: Object.keys(spacing).length > 0 ? spacing : undefined,
      button: Object.keys(button).length > 0 ? button : undefined,
      shadow: Object.keys(shadow).length > 0 ? shadow : undefined,
      headerStyle: headerStyle || undefined,
      heroStyle: heroStyle || undefined,
    };
    const blob = new Blob([JSON.stringify(tokens, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "theme-overrides.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const validation = validateThemeTokens(parsed);
        if (!validation.valid) {
          setError(`Import failed: ${validation.errors.join(", ")}`);
          return;
        }
        const t = validation.tokens!;
        if (t.colors) setColors(t.colors);
        if (t.fonts) setFonts(t.fonts as Record<string, string>);
        if (t.scale) setScale(t.scale);
        if (t.radius) setRadius(t.radius);
        if (t.spacing) setSpacing(t.spacing);
        if (t.button) setButton(t.button);
        if (t.shadow) setShadow(t.shadow);
        if (t.headerStyle) setHeaderStyle(t.headerStyle);
        if (t.heroStyle) setHeroStyle(t.heroStyle);
        scheduleSave();
        flash("Theme imported and applied to draft.");
      } catch {
        setError("Import failed: invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  if (!draftLoaded) {
    return <div className="py-8 text-center text-sm text-gray-500">Loading theme editor…</div>;
  }

  return (
    <div className="space-y-4">
      {/*
        Theme-scoped action bar. Everything here acts on the THEME DRAFT.
        Site-level actions (take live / take offline) are in the page header
        so the two publishes are never confused.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center gap-2 min-w-0">
          {hasUnpublished ? (
            <Badge variant="amber">Draft not yet live</Badge>
          ) : (
            <Badge variant="green">Matches live site</Badge>
          )}
          {saving && <span className="text-xs text-gray-500">Saving…</span>}
          {lastSaved && !saving && (
            <span className="text-xs text-gray-400">Saved {lastSaved}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => { await saveNow(); setShowPreview(true); }}
            title="See the theme you are editing, before publishing"
          >
            <Monitor size={13} /> Preview draft
          </Button>
          <Button size="sm" variant="secondary" onClick={exportTheme}>
            <Download size={13} /> Export
          </Button>
          <label className="cursor-pointer inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-[#0F2A47] hover:bg-gray-50 px-3 py-1.5 text-xs font-medium transition-all">
            <UploadIcon size={13} /> Import
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => e.target.files?.[0] && handleImport(e.target.files[0])}
            />
          </label>
          {hasUnpublished && (
            <>
              <Button size="sm" variant="secondary" onClick={handleDiscard}>
                <Undo2 size={13} /> Discard
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={() => setShowPublishConfirm(true)}
                disabled={!isAdmin}
                loading={publishing}
                title="Apply this theme to the public site"
              >
                <Rocket size={13} /> Apply to live site
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Panel tabs */}
      <div className="flex flex-wrap gap-1.5">
        {PANELS.map(p => (
          <button
            key={p.id}
            onClick={() => setPanel(p.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              panel === p.id ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      {panel === "gallery" && (
        <GalleryPanel
          themes={themes}
          selectedKey={themeKey}
          selectedCustomId={customThemeId}
          customThemes={customThemes}
          onSelectTheme={selectTheme}
          onSelectCustom={selectCustomTheme}
          onApplyLayout={async (key) => {
            const { data, error } = await supabase.rpc("apply_theme_layout", {
              p_theme_key: key, p_page_slug: "", p_mode: "append",
            });
            if (error) { setError(error.message); return; }
            const result = data as { ok?: boolean; sections_added?: number; message?: string } | null;
            if (result?.ok) {
              flash(`Added ${result.sections_added ?? 0} section(s) from the theme layout.`);
              await onSiteUpdate();
            }
          }}
        />
      )}

      {panel === "colors" && (
        <ColorsPanel
          colors={colors}
          themeColors={activeTheme?.tokens?.colors ?? {}}
          onUpdate={updateColor}
        />
      )}

      {panel === "typography" && (
        <TypographyPanel
          fonts={fonts}
          themeFonts={activeTheme?.tokens?.fonts}
          onUpdate={updateFont}
          siteName={site.site_name}
        />
      )}

      {panel === "shape" && (
        <ShapePanel
          scale={scale}
          radius={radius}
          spacing={spacing}
          button={button}
          shadow={shadow}
          headerStyle={headerStyle}
          heroStyle={heroStyle}
          themeTokens={activeTheme?.tokens ?? {}}
          onUpdateScale={updateScale}
          onUpdateRadius={updateRadius}
          onUpdateSpacing={updateSpacing}
          onUpdateButton={updateButton}
          onUpdateShadow={updateShadow}
          onHeaderStyle={v => { setHeaderStyle(v); scheduleSave(); }}
          onHeroStyle={v => { setHeroStyle(v); scheduleSave(); }}
        />
      )}

      {panel === "contrast" && (
        <Card>
          <CardHeader><CardTitle>WCAG Contrast Audit</CardTitle></CardHeader>
          <CardContent>
            <ContrastChecker colors={resolvedColors} />
          </CardContent>
        </Card>
      )}

      {panel === "custom" && (
        <CustomThemeManager
          supabase={supabase}
          themes={customThemes}
          platformThemes={themes}
          onThemeSelect={selectCustomTheme}
          onReload={onSiteUpdate}
          flash={flash}
          setError={setError}
        />
      )}

      {/* Device preview overlay */}
      {showPreview && (
        <DevicePreview
          previewUrl="/dashboard/website/preview"
          label="Draft theme"
          isDraft
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Publish confirmation */}
      {showPublishConfirm && (
        <Modal open onClose={() => setShowPublishConfirm(false)} title="Publish changes?" size="md">
          <p className="text-sm text-gray-600 mb-4">
            This will promote your draft theme, colours and typography to the live public website.
            A snapshot of the current published state is saved automatically.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowPublishConfirm(false)}>Cancel</Button>
            <Button variant="gold" loading={publishing} onClick={handlePublish}>
              <Rocket size={14} /> Publish now
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gallery Panel                                                        */
/* ------------------------------------------------------------------ */

function GalleryPanel({
  themes, selectedKey, selectedCustomId, customThemes, onSelectTheme, onSelectCustom, onApplyLayout,
}: {
  themes: WebsiteTheme[];
  selectedKey: string | null;
  selectedCustomId: string | null;
  customThemes: CustomTheme[];
  onSelectTheme: (key: string) => void;
  onSelectCustom: (id: string) => void;
  onApplyLayout?: (themeKey: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Theme library</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Switching theme changes your base colours, type and spacing. Your content and overrides stay intact.
          </p>
          <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <Info size={14} className="mt-px shrink-0" />
            <div>
              <strong>Picking a theme changes colour, type and texture — not your page layout.</strong>{" "}
              Your sections stay exactly as they are, which is deliberate: your
              content is never rewritten behind your back. To also adopt the
              theme&apos;s recommended section order, use{" "}
              <strong>Apply recommended layout</strong> below the gallery.
            </div>
          </div>

          <ThemeGallery
            themes={themes}
            activeKey={selectedCustomId ? undefined : selectedKey}
            onSelect={onSelectTheme}
            actionLabel="Apply theme"
          />

          {selectedKey && !selectedCustomId && onApplyLayout && (
            <ApplyLayoutPanel
              theme={themes.find(t => t.key === selectedKey)}
              onApply={onApplyLayout}
            />
          )}
        </CardContent>
      </Card>

      {customThemes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Your custom themes</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customThemes.map(ct => {
                const colors = ct.tokens?.colors ?? {};
                const isActive = selectedCustomId === ct.id;
                return (
                  <button
                    key={ct.id}
                    onClick={() => onSelectCustom(ct.id)}
                    className={cn(
                      "text-left rounded-xl border overflow-hidden transition-all",
                      isActive ? "border-[#C9A227] ring-2 ring-[#C9A227]/30" : "border-gray-200 hover:border-gray-300"
                    )}
                  >
                    <div className="h-16 flex" aria-hidden="true">
                      {["primary", "secondary", "accent", "surface", "background"].map(k => (
                        <div key={k} className="flex-1" style={{ background: colors[k] ?? "#eee" }} />
                      ))}
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-[#0F2A47]">{ct.name}</span>
                        {isActive && <Badge variant="amber">Active</Badge>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{ct.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Colors Panel                                                         */
/* ------------------------------------------------------------------ */

function ColorsPanel({
  colors, themeColors, onUpdate,
}: {
  colors: Record<string, string>;
  themeColors: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
}) {
  const effective = (key: string) => colors[key] || themeColors[key] || "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette size={15} /> Colour overrides</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-500">
          Leave blank to inherit from the selected theme. Changes autosave to your draft.
        </p>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {COLOR_ROLES.map(role => (
            <div key={role.key} className="flex items-center gap-2">
              <label htmlFor={`c-${role.key}`} className="flex-1 min-w-0 text-sm text-gray-700">
                {role.label}
                <span className="block text-[10px] text-gray-400 truncate">{role.hint}</span>
              </label>
              <input
                id={`c-${role.key}`}
                type="color"
                value={effective(role.key) || "#000000"}
                onChange={e => onUpdate(role.key, e.target.value)}
                className="w-9 h-9 rounded border border-gray-300 shrink-0 cursor-pointer"
              />
              <input
                type="text"
                value={colors[role.key] ?? ""}
                onChange={e => onUpdate(role.key, e.target.value)}
                placeholder={themeColors[role.key] ?? ""}
                className="w-24 shrink-0 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
              />
              {colors[role.key] && (
                <button
                  onClick={() => onUpdate(role.key, "")}
                  className="text-[10px] text-gray-400 hover:text-red-500"
                  title="Reset to theme default"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => {
          COLOR_ROLES.forEach(r => onUpdate(r.key, ""));
        }}>
          <RefreshCw size={12} /> Reset all to theme defaults
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Typography Panel                                                     */
/* ------------------------------------------------------------------ */

function TypographyPanel({
  fonts, themeFonts, onUpdate, siteName,
}: {
  fonts: Record<string, string>;
  themeFonts?: { heading?: string; body?: string; accent?: string };
  onUpdate: (slot: string, value: string) => void;
  siteName: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Type size={15} /> Typography</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(["heading", "body", "accent"] as const).map(slot => (
          <div key={slot}>
            <label htmlFor={`font-${slot}`} className="block text-sm font-medium text-gray-700 mb-1 capitalize">
              {slot} font
            </label>
            <select
              id={`font-${slot}`}
              value={fonts[slot] ?? ""}
              onChange={e => onUpdate(slot, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              style={{ fontFamily: fonts[slot] || themeFonts?.[slot] }}
            >
              <option value="">Theme default ({themeFonts?.[slot] ?? "—"})</option>
              <optgroup label="Sans serif">
                {FONT_LIBRARY.sans.map(f => <option key={f} value={f}>{f}</option>)}
              </optgroup>
              <optgroup label="Serif">
                {FONT_LIBRARY.serif.map(f => <option key={f} value={f}>{f}</option>)}
              </optgroup>
            </select>
          </div>
        ))}

        <div className="p-4 rounded-lg border border-gray-200" aria-label="Typography preview">
          <p
            className="text-xl font-bold"
            style={{ fontFamily: fonts.heading || themeFonts?.heading }}
          >
            {siteName}
          </p>
          <p
            className="text-sm mt-1.5 text-gray-600"
            style={{ fontFamily: fonts.body || themeFonts?.body }}
          >
            The quick brown fox jumps over the lazy dog. 0123456789
          </p>
          <p
            className="text-xs mt-1 text-gray-400 italic"
            style={{ fontFamily: fonts.accent || themeFonts?.accent }}
          >
            Accent font sample — labels and captions
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shape & Spacing Panel                                                */
/* ------------------------------------------------------------------ */

function ShapePanel({
  scale, radius, spacing, button, shadow, headerStyle, heroStyle, themeTokens,
  onUpdateScale, onUpdateRadius, onUpdateSpacing, onUpdateButton, onUpdateShadow,
  onHeaderStyle, onHeroStyle,
}: {
  scale: Record<string, string>;
  radius: Record<string, string>;
  spacing: Record<string, string>;
  button: Record<string, string>;
  shadow: Record<string, string>;
  headerStyle: string;
  heroStyle: string;
  themeTokens: ThemeTokens;
  onUpdateScale: (k: string, v: string) => void;
  onUpdateRadius: (k: string, v: string) => void;
  onUpdateSpacing: (k: string, v: string) => void;
  onUpdateButton: (k: string, v: string) => void;
  onUpdateShadow: (k: string, v: string) => void;
  onHeaderStyle: (v: string) => void;
  onHeroStyle: (v: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Type scale</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {["h1", "h2", "h3", "body"].map(k => (
            <TokenField
              key={k}
              label={k}
              value={scale[k] ?? ""}
              placeholder={themeTokens.scale?.[k] ?? ""}
              onChange={v => onUpdateScale(k, v)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Border radius</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {["sm", "md", "lg", "pill"].map(k => (
            <TokenField
              key={k}
              label={k}
              value={radius[k] ?? ""}
              placeholder={themeTokens.radius?.[k] ?? ""}
              onChange={v => onUpdateRadius(k, v)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Spacing</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {["section", "gap"].map(k => (
            <TokenField
              key={k}
              label={k}
              value={spacing[k] ?? ""}
              placeholder={themeTokens.spacing?.[k] ?? ""}
              onChange={v => onUpdateSpacing(k, v)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Button style</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <TokenField
            label="radius"
            value={button.radius ?? ""}
            placeholder={themeTokens.button?.radius ?? "0.75rem"}
            onChange={v => onUpdateButton("radius", v)}
          />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">weight</label>
            <select
              value={button.weight ?? ""}
              onChange={e => onUpdateButton("weight", e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">Default ({themeTokens.button?.weight ?? "600"})</option>
              {["400", "500", "600", "700", "800"].map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">transform</label>
            <select
              value={button.transform ?? ""}
              onChange={e => onUpdateButton("transform", e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">Default ({themeTokens.button?.transform ?? "none"})</option>
              {["none", "uppercase", "lowercase", "capitalize"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shadow</CardTitle></CardHeader>
        <CardContent>
          <TokenField
            label="card"
            value={shadow.card ?? ""}
            placeholder={themeTokens.shadow?.card ?? "0 1px 3px rgba(15,23,42,.08)"}
            onChange={v => onUpdateShadow("card", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Layout</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Header style</label>
            <select
              value={headerStyle}
              onChange={e => onHeaderStyle(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">Default ({themeTokens.headerStyle ?? "light"})</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="minimal">Minimal</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hero style</label>
            <select
              value={heroStyle}
              onChange={e => onHeroStyle(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">Default ({themeTokens.heroStyle ?? "image-right"})</option>
              <option value="centered">Centered</option>
              <option value="image-right">Image right</option>
              <option value="full-bleed">Full bleed</option>
              <option value="gradient">Gradient</option>
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TokenField({
  label, value, placeholder, onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 text-xs font-medium text-gray-600">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
      />
      {value && (
        <button onClick={() => onChange("")} className="text-[10px] text-gray-400 hover:text-red-500">×</button>
      )}
    </div>
  );
}


function ApplyLayoutPanel({
  theme, onApply,
}: {
  theme: WebsiteTheme | undefined;
  onApply: (key: string) => void;
}) {
  if (!theme || !theme.default_sections || theme.default_sections.length === 0) return null;
  return (
    <div className="mt-4 p-4 rounded-lg border border-dashed border-[#C9A227] bg-[#FBF6E8]">
      <div className="flex items-start gap-3">
        <LayoutTemplate size={18} className="text-[#C9A227] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0F2A47]">
            Also adopt this theme&apos;s recommended page layout?
          </p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            This adds the sections <strong>{theme.name}</strong> was designed around to your
            home page (without removing what you already have). It is undoable from History.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {theme.default_sections.map(s => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                {s.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          <Button
            size="sm"
            variant="gold"
            className="mt-3"
            onClick={() => onApply(theme.key)}
          >
            <LayoutTemplate size={13} /> Apply recommended layout
          </Button>
        </div>
      </div>
    </div>
  );
}
