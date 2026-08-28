/**
 * Passthrough: /s/<slug>/dashboard/... forwards to /dashboard/... so an old
 * school-branded link still works. The middleware keeps the sf_last_school
 * cookie in step so future signed-out redirects come back to /s/<slug>/login.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string; path?: string[] };
}

export default function SchoolScopedDashboardPassthrough({ params }: Props) {
  const tail = (params.path ?? []).join("/");
  const dest = tail ? `/dashboard/${tail}` : "/dashboard";
  redirect(dest);
}
