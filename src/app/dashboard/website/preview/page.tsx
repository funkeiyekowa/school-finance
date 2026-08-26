"use client";

/**
 * Draft preview.
 *
 * Renders the school's site using the UNPUBLISHED draft theme, so the
 * studio's Preview button shows what you are about to publish rather than
 * what is already live.
 *
 * This lives under /dashboard so it inherits the authenticated session —
 * the get_draft_preview RPC is org-scoped and refuses anonymous callers.
 * It deliberately does NOT use the public /s/<slug> route, because that
 * route reads only the published websites row.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveTheme, themeToCss, googleFontsHref } from "@/lib/website/theme";
import { RenderSection, type SectionContext } from "@/components/website/sections";
import type { PagePayload } from "@/lib/website/types";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function DraftPreviewPage() {
  const params = useSearchParams();
  const slug = params.get("page") ?? "";
  const supabase = useMemo(() => createClient(), []);

  const [payload, setPayload] = useState<PagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Find this org's website first — the RPC needs its id.
    const { data: siteRow, error: siteErr } = await supabase
      .from("websites").select("id").maybeSingle();

    if (siteErr || !siteRow) {
      setError("No website found for this school yet.");
      setLoading(false);
      return;
    }

    const { data, error: rpcErr } = await supabase.rpc("get_draft_preview", {
      p_website_id: (siteRow as { id: string }).id,
      p_slug: slug,
    });

    if (rpcErr) {
      setError(
        rpcErr.message.includes("does not exist")
          ? "get_draft_preview is missing. Run supabase/website_studio_upgrade_migration.sql."
          : rpcErr.message
      );
    } else if (!data) {
      setError("Nothing to preview yet.");
    } else {
      setPayload(data as PagePayload);
    }
    setLoading(false);
  }, [supabase, slug]);

  useEffect(() => { load(); }, [load]);

  /* The studio tells us to refresh by bumping a message; that keeps the
     iframe cheap instead of forcing a full remount. */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data === "refresh-draft-preview") load();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <div className="text-center">
          <Loader2 size={24} className="mx-auto animate-spin text-gray-400 mb-2" />
          <p className="text-sm text-gray-500">Building draft preview…</p>
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 px-6">
        <div className="max-w-sm text-center">
          <AlertTriangle size={26} className="mx-auto text-amber-500 mb-3" />
          <p className="text-sm text-gray-700">{error ?? "Nothing to preview."}</p>
        </div>
      </div>
    );
  }

  if (payload.not_found) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 px-6">
        <p className="text-sm text-gray-600">
          That page does not exist yet. Create it under Pages &amp; Sections.
        </p>
      </div>
    );
  }

  const theme = resolveTheme(payload.theme, payload.site);
  const css = themeToCss(theme, ".site-root");
  const fontsHref = googleFontsHref(theme);

  const ctx: SectionContext = {
    site: payload.site,
    news: payload.news ?? [],
    events: payload.events ?? [],
    forms: payload.forms ?? [],
    basePath: "",
    currentPath: `/${slug}`,
    heroStyle: theme.heroStyle,
    headerStyle: theme.headerStyle,
  };

  return (
    <>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Draft watermark so a screenshot is never mistaken for the live site */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "#C9A227", color: "#0F2A47",
          font: "700 11px/1 system-ui, sans-serif", letterSpacing: ".12em",
          textTransform: "uppercase", textAlign: "center", padding: "5px 0",
        }}
      >
        Draft preview · not yet published
      </div>

      <div className="site-root" style={{ paddingTop: 21 }}>
        {theme.grain && <div className="grain-overlay" aria-hidden="true" />}
        <main>
          {(payload.sections ?? []).map((section, i) => (
            <RenderSection key={section.id} section={section} ctx={ctx} index={i} />
          ))}
        </main>
      </div>
    </>
  );
}
