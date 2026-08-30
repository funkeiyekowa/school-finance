import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveBySlug } from "@/lib/website/render";

function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const resolution = await resolveBySlug(slug);

  if (!resolution?.available || !resolution.website_id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = publicClient();
  const { data: site } = await supabase
    .from("websites")
    .select("seo")
    .eq("id", resolution.website_id)
    .single();

  const seo = (site?.seo ?? {}) as Record<string, string>;
  const noindex = seo.robots === "noindex";

  const sitemapPath = `/s/${slug}/sitemap.xml`;

  const body = noindex
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\n\nSitemap: ${sitemapPath}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
