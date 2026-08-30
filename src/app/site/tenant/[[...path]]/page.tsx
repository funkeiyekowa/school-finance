/**
 * Host-addressed public site.
 *
 * Middleware rewrites any non-platform hostname here. The tenant is resolved
 * from the Host header via resolve_site_by_host(), whose UNIQUE constraints on
 * websites.subdomain and website_domains.hostname guarantee one host maps to
 * exactly one school.
 *
 * basePath is empty because the school is on its own domain, so internal links
 * are plain absolute paths.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveByHost, renderSite, buildMetadata } from "@/lib/website/render";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ path?: string[] }>;
}

async function currentHost(): Promise<string> {
  const h = await headers();
  // x-forwarded-host is set by the proxy in front of the app; fall back to host.
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const resolution = await resolveByHost(await currentHost());
  return buildMetadata(resolution, path);
}

export default async function TenantSiteByHost({ params }: Props) {
  const { path } = await params;
  const resolution = await resolveByHost(await currentHost());
  return renderSite({
    resolution,
    segments: path,
    basePath: "",
  });
}
