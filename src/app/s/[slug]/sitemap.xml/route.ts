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
  { params }: { params: { slug: string } }
) {
  const { slug } = params;
  const resolution = await resolveBySlug(slug);

  if (!resolution?.available || !resolution.website_id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = publicClient();
  const basePath = `/s/${slug}`;

  const { data: pages } = await supabase
    .from("website_pages")
    .select("slug, updated_at")
    .eq("website_id", resolution.website_id)
    .eq("status", "published");

  const { data: articles } = await supabase
    .from("website_news")
    .select("slug, published_at")
    .eq("organization_id", resolution.organization_id!)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  const urls: string[] = [];

  for (const page of pages ?? []) {
    const loc = page.slug === "" ? basePath : `${basePath}/${page.slug}`;
    const lastmod = page.updated_at
      ? new Date(page.updated_at).toISOString().split("T")[0]
      : undefined;
    const priority = page.slug === "" ? "1.0" : "0.7";
    const changefreq = page.slug === "" ? "weekly" : "monthly";

    urls.push(
      `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
    );
  }

  for (const article of articles ?? []) {
    const loc = `${basePath}/news/${article.slug}`;
    const lastmod = article.published_at
      ? new Date(article.published_at).toISOString().split("T")[0]
      : undefined;

    urls.push(
      `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
