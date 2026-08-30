import { createClient } from "@supabase/supabase-js";

/**
 * Read the public bits of a school (name + logo) by slug, for the header of
 * the school-scoped login screen. Uses the anon client (no session).
 *
 * Primary source is the SECURITY DEFINER RPC `resolve_school_brand_by_slug`
 * which reads directly from `organizations` and does NOT require the school
 * to have a Website Studio row provisioned. The older path called
 * `resolve_site_by_slug` (which returns null when the site is unpublished
 * or missing) and a direct RLS-blocked SELECT on `organizations`, both of
 * which produced spurious "School not found" errors for real, active
 * schools that had not yet set up their public website.
 */
export interface SchoolBrand {
  organization_id: string | null;
  name: string;
  slug: string;
  logo_url: string | null;
  found: boolean;
  /** Present when found; useful for suspended-org UX later. */
  status?: string;
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function fetchSchoolBrand(slug: string): Promise<SchoolBrand> {
  const cleaned = (slug ?? "").trim().toLowerCase();
  if (!cleaned) {
    return { organization_id: null, name: "School", slug: "", logo_url: null, found: false };
  }
  const client = anonClient();

  // Preferred: SECURITY DEFINER RPC that always returns the org row when
  // the slug matches, regardless of website/publish state.
  const { data: brand } = await client.rpc("resolve_school_brand_by_slug", { p_slug: cleaned });
  const first = Array.isArray(brand) ? brand[0] : brand;
  if (first && typeof first === "object" && "organization_id" in first) {
    const row = first as {
      organization_id?: string | null;
      organization_name?: string | null;
      organization_slug?: string | null;
      logo_url?: string | null;
      status?: string | null;
    };
    if (row.organization_id) {
      return {
        organization_id: row.organization_id,
        name: row.organization_name || "School",
        slug: row.organization_slug || cleaned,
        logo_url: row.logo_url ?? null,
        status: row.status ?? undefined,
        found: true,
      };
    }
  }

  // Legacy fallbacks — kept only in case the new RPC isn't deployed yet.
  // Once the upgrades_2026_08.sql migration has run in every environment,
  // these can be removed. They will return null under normal RLS.
  const { data: legacyRpc } = await client.rpc("resolve_site_by_slug", { p_slug: cleaned });
  const legacy = legacyRpc as
    | { found?: boolean; organization_id?: string; organization_name?: string }
    | null;
  if (legacy?.organization_id) {
    return {
      organization_id: legacy.organization_id,
      name: legacy.organization_name || "School",
      slug: cleaned,
      logo_url: null,
      found: true,
    };
  }

  return {
    organization_id: null,
    name: "School",
    slug: cleaned,
    logo_url: null,
    found: false,
  };
}
