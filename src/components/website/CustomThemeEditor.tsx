"use client";

import { useCallback, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { validateThemeTokens } from "@/lib/website/theme-validator";
import { COLOR_ROLES, FONT_LIBRARY } from "@/lib/website/theme";
import type { CustomTheme, WebsiteTheme, ThemeTokens } from "@/lib/website/types";
import {
  Plus, Trash2, Copy, Download, Upload, Pencil, Save, Palette,
} from "lucide-react";

export interface CustomThemeManagerProps {
  supabase: SupabaseClient;
  themes: CustomTheme[];
  platformThemes: WebsiteTheme[];
  onThemeSelect: (customThemeId: string) => void;
  onReload: () => Promise<void>;
  flash: (msg: string) => void;
  setError: (msg: string) => void;
}

const HEADER_STYLES = ["light", "dark", "minimal"];
const HERO_STYLES = ["centered", "image-right", "full-bleed", "gradient"];

export function CustomThemeManager({
  supabase, themes, platformThemes, onThemeSelect, onReload, flash, setError,
}: CustomThemeManagerProps) {
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    based_on: "",
    tokens: {} as ThemeTokens,
  });

  function openCreate() {
    setForm({ name: "", description: "", based_on: "", tokens: {} });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(t: CustomTheme) {
    setForm({ name: t.name, description: t.description ?? "", based_on: t.based_on ?? "", tokens: t.tokens });
    setEditing(t);
    setCreating(true);
  }

  function applyBase(key: string) {
    const base = platformThemes.find(p => p.key === key);
    if (base?.tokens) setForm(f => ({ ...f, based_on: key, tokens: { ...base.tokens } }));
  }

  async function save() {
    if (!form.name.trim()) { setError("Theme name is required"); return; }
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      based_on: form.based_on || null,
      tokens: form.tokens,
    };

    const { error } = editing
      ? await supabase.from("website_custom_themes").update(payload).eq("id", editing.id)
      : await supabase.from("website_custom_themes").insert(payload);

    setBusy(false);
    if (error) { setError(error.message); return; }
    setCreating(false);
    setEditing(null);
    flash(editing ? "Theme updated." : "Theme created.");
    await onReload();
  }

  async function duplicate(t: CustomTheme) {
    setBusy(true);
    const { error } = await supabase.from("website_custom_themes").insert({
      name: `${t.name} (copy)`,
      description: t.description,
      based_on: t.based_on,
      tokens: t.tokens,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    flash("Theme duplicated.");
    await onReload();
  }

  async function rename(t: CustomTheme) {
    const newName = prompt("Rename theme:", t.name);
    if (!newName || newName === t.name) return;
    const { error } = await supabase.from("website_custom_themes")
      .update({ name: newName }).eq("id", t.id);
    if (error) { setError(error.message); return; }
    flash("Theme renamed.");
    await onReload();
  }

  async function remove(t: CustomTheme) {
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("website_custom_themes").delete().eq("id", t.id);
    if (error) { setError(error.message); return; }
    flash("Theme deleted.");
    await onReload();
  }

  function exportTheme(t: CustomTheme) {
    const json = JSON.stringify({ name: t.name, tokens: t.tokens }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.name.replace(/\s+/g, "-").toLowerCase()}-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const name = typeof parsed.name === "string" ? parsed.name : file.name.replace(/\.json$/, "");
      const tokens = parsed.tokens ?? parsed;
      const result = validateThemeTokens(tokens);
      if (!result.valid) {
        setError(`Import failed: ${result.errors.slice(0, 3).join("; ")}`);
        return;
      }
      setBusy(true);
      const { error } = await supabase.from("website_custom_themes").insert({
        name,
        tokens: result.tokens,
      });
      setBusy(false);
      if (error) { setError(error.message); return; }
      flash("Theme imported.");
      await onReload();
    } catch {
      setError("Failed to parse JSON file.");
    }
    if (fileRef.current) fileRef.current.value = "";
  }, [supabase, onReload, flash, setError]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Palette size={15} /> Custom themes ({themes.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Import
            </Button>
            <Button size="sm" variant="gold" onClick={openCreate}>
              <Plus size={13} /> New theme
            </Button>
            <input ref={fileRef} type="file" accept=".json" className="hidden"
              onChange={handleImport} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {themes.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No custom themes yet. Create one or import a JSON file.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map(t => {
              const colors = t.tokens?.colors ?? {};
              return (
                <div key={t.id} className="rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="h-16 flex" aria-hidden="true">
                    {["primary", "secondary", "accent", "surface", "background"].map(k => (
                      <div key={k} className="flex-1" style={{ background: colors[k] ?? "#eee" }} />
                    ))}
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <h4 className="font-bold text-sm text-[#0F2A47] truncate">{t.name}</h4>
                    {t.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex items-center gap-1 mt-auto pt-2">
                      <button onClick={() => onThemeSelect(t.id)} title="Use this theme"
                        className="flex-1 px-2 py-1.5 text-xs font-semibold bg-[#C9A227] text-[#0F2A47] rounded-lg hover:bg-[#b8911e] transition-colors">
                        Select
                      </button>
                      <IconBtn label="Edit" onClick={() => openEdit(t)}><Pencil size={12} /></IconBtn>
                      <IconBtn label="Duplicate" onClick={() => duplicate(t)}><Copy size={12} /></IconBtn>
                      <IconBtn label="Rename" onClick={() => rename(t)}><Pencil size={11} /></IconBtn>
                      <IconBtn label="Export" onClick={() => exportTheme(t)}><Download size={12} /></IconBtn>
                      <IconBtn label="Delete" onClick={() => remove(t)} danger><Trash2 size={12} /></IconBtn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {creating && (
        <Modal open onClose={() => setCreating(false)}
          title={editing ? `Edit: ${editing.name}` : "New custom theme"} size="xl">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <Input label="Theme name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Our School Colors" />
            <Input label="Description (optional)" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Based on our brand guidelines" />

            {!editing && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start from a platform theme (optional)
                </label>
                <select value={form.based_on}
                  onChange={e => applyBase(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">Blank — start from scratch</option>
                  {platformThemes.map(p => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <TokenEditor tokens={form.tokens}
              onChange={tokens => setForm(f => ({ ...f, tokens }))} />

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="gold" loading={busy} disabled={!form.name.trim()} onClick={save}>
                <Save size={14} /> {editing ? "Save changes" : "Create theme"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function TokenEditor({ tokens, onChange }: { tokens: ThemeTokens; onChange: (t: ThemeTokens) => void }) {
  const colors = tokens.colors ?? {};
  const fonts = tokens.fonts ?? {};

  const setColor = (key: string, value: string) =>
    onChange({ ...tokens, colors: { ...colors, [key]: value } });
  const setFont = (slot: string, value: string) =>
    onChange({ ...tokens, fonts: { ...fonts, [slot]: value } as ThemeTokens["fonts"] });

  return (
    <div className="space-y-4">
      <details open className="group">
        <summary className="cursor-pointer text-sm font-semibold text-[#0F2A47] mb-2">
          Colors ({Object.keys(colors).length}/14)
        </summary>
        <div className="grid gap-2 sm:grid-cols-2">
          {COLOR_ROLES.map(role => (
            <div key={role.key} className="flex items-center gap-2">
              <input type="color" value={colors[role.key] || "#808080"}
                onChange={e => setColor(role.key, e.target.value)}
                className="w-7 h-7 rounded border border-gray-300 shrink-0 cursor-pointer" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-gray-700 block truncate">{role.label}</span>
              </div>
              <input type="text" value={colors[role.key] ?? ""}
                onChange={e => setColor(role.key, e.target.value)}
                placeholder="#000000"
                className="w-20 shrink-0 px-1.5 py-1 border border-gray-300 rounded text-xs font-mono" />
            </div>
          ))}
        </div>
      </details>

      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-[#0F2A47] mb-2">Fonts</summary>
        <div className="space-y-2">
          {(["heading", "body", "accent"] as const).map(slot => (
            <div key={slot} className="flex items-center gap-2">
              <label className="text-xs text-gray-700 w-16 shrink-0 capitalize">{slot}</label>
              <select value={fonts[slot] ?? ""}
                onChange={e => setFont(slot, e.target.value)}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                <option value="">— not set —</option>
                <optgroup label="Sans serif">
                  {FONT_LIBRARY.sans.map(f => <option key={f} value={f}>{f}</option>)}
                </optgroup>
                <optgroup label="Serif">
                  {FONT_LIBRARY.serif.map(f => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              </select>
            </div>
          ))}
        </div>
      </details>

      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-[#0F2A47] mb-2">Style</summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Header style</label>
            <select value={tokens.headerStyle ?? ""}
              onChange={e => onChange({ ...tokens, headerStyle: e.target.value || undefined })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
              <option value="">— default —</option>
              {HEADER_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Hero style</label>
            <select value={tokens.heroStyle ?? ""}
              onChange={e => onChange({ ...tokens, heroStyle: e.target.value || undefined })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
              <option value="">— default —</option>
              {HERO_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </details>

      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-[#0F2A47] mb-2">
          Scale, radius &amp; spacing
        </summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <UnitGroup label="Scale" keys={["h1", "h2", "h3", "body"]}
            group={tokens.scale} onChange={v => onChange({ ...tokens, scale: v })} />
          <UnitGroup label="Radius" keys={["sm", "md", "lg", "pill"]}
            group={tokens.radius} onChange={v => onChange({ ...tokens, radius: v })} />
          <UnitGroup label="Spacing" keys={["section", "gap"]}
            group={tokens.spacing} onChange={v => onChange({ ...tokens, spacing: v })} />
          <UnitGroup label="Button" keys={["radius", "weight", "transform"]}
            group={tokens.button} onChange={v => onChange({ ...tokens, button: v })} />
          <UnitGroup label="Shadow" keys={["card"]}
            group={tokens.shadow} onChange={v => onChange({ ...tokens, shadow: v })} />
        </div>
      </details>
    </div>
  );
}

function UnitGroup({ label, keys, group, onChange }: {
  label: string;
  keys: string[];
  group: Record<string, string> | undefined;
  onChange: (v: Record<string, string>) => void;
}) {
  const vals = group ?? {};
  return (
    <fieldset className="border border-gray-200 rounded-lg p-2">
      <legend className="text-xs font-medium text-gray-600 px-1">{label}</legend>
      <div className="space-y-1.5">
        {keys.map(k => (
          <div key={k} className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 w-14 shrink-0">{k}</label>
            <input type="text" value={vals[k] ?? ""}
              onChange={e => onChange({ ...vals, [k]: e.target.value })}
              placeholder="e.g. 1rem"
              className="flex-1 px-1.5 py-1 border border-gray-200 rounded text-xs font-mono" />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function IconBtn({ children, label, onClick, danger }: {
  children: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn(
        "p-1.5 rounded transition-colors",
        danger ? "text-red-500 hover:bg-red-50" : "text-gray-500 hover:bg-gray-100"
      )}>
      {children}
    </button>
  );
}
