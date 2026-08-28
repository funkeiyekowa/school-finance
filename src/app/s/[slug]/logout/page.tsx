"use client";

/**
 * School-scoped logout - clears the session and returns to /s/<slug>/login.
 */
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SchoolLogoutPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Surface the sign-out error rather than silently sitting on the page.
        // eslint-disable-next-line no-console
        console.error("[school logout] signOut error:", error.message);
      }
      if (!cancelled) {
        router.replace(slug ? `/s/${slug}/login` : "/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5F0]">
      <div className="text-sm text-gray-500">Signing you out&hellip;</div>
    </div>
  );
}
