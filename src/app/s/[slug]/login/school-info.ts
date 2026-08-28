import { createClient } from "@supabase/supabase-js";

/**
 * Read the public bits of a school (name + logo) by slug, for the header of
 * the school-scoped login screen. Uses the anon client (no session) — this
 * data is already public via resolve_site_by_slug + the site page.
 */
export interface SchoolBrand {
  organization_id: string | null;
  name: string;
  slug: string;
  logo_url: string | null;
  found: boolean;
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function fetchSchoolBrand(slug: string): Promise<SchoolBrand> {
  const cleaned = (slug ?? "").trim().toLowerCase();
  if (!cleaned) {
    return { organization_id: null, name: "School", slug: "", logo_url: null, found: false };
  }
  const client = anonClient();

  // resolve_site_by_slug returns a jsonb summary — good enough for name.
  const { data: rpcData } = await client.rpc("resolve_site_by_slug", { p_slug: cleaned });
  const rpc = rpcData as
    | { found?: boolean; organization_id?: string; organization_name?: string }
    | null;

  // Fall back to a direct read on organizations for the logo (anon-readable).
  let logoUrl: string | null = null;
  let name = rpc?.organization_name ?? "School";
  let orgId = rpc?.organization_id ?? null;

  const { data: org } = await client
    .from("organizations")
    .select("id, name, logo_url")
    .eq("slug", cleaned)
    .maybeSingle();

  if (org) {
    orgId = (org as { id: string }).id ?? orgId;
    name = (org as { name?: string }).name ?? name;
    logoUrl = (org as { logo_url?: string | null }).logo_url ?? null;
  }

  return {
    organization_id: orgId,
    name,
    slug: cleaned,
    logo_url: logoUrl,
    found: Boolean(orgId),
  };
}
