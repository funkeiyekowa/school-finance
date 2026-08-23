/**
 * Slug-addressed public site: /s/<organization-slug>/<page>
 *
 * This path always works, with no DNS setup, so a school can preview and
 * share its site before a custom domain is verified. Custom hosts are
 * rewritten onto /site/tenant by middleware instead.
 */

import type { Metadata } from "next";
import { resolveBySlug, renderSite, buildMetadata } from "@/lib/website/render";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: { slug: string; path?: string[] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolution = await resolveBySlug(params.slug);
  return buildMetadata(resolution, params.path);
}

export default async function TenantSiteBySlug({ params }: Props) {
  const resolution = await resolveBySlug(params.slug);
  return renderSite({
    resolution,
    segments: params.path,
    basePath: `/s/${params.slug}`,
  });
}
