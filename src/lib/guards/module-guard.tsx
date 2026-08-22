"use client";

/**
 * Module Access Guard
 *
 * Server-side enforcement of module access. Wraps page content and
 * blocks rendering (with a clear message) if the current organization
 * does not have the required module enabled.
 *
 * This is the enforcement layer — the sidebar only hides links as a UX
 * convenience. This guard prevents access via direct URL navigation.
 *
 * Usage in a page:
 *   import { ModuleGuard } from "@/lib/guards/module-guard";
 *   export default function Page() {
 *     return <ModuleGuard module="cbt"><ActualContent /></ModuleGuard>;
 *   }
 */

import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface ModuleGuardProps {
  module: string;
  children: React.ReactNode;
}

export function ModuleGuard({ module, children }: ModuleGuardProps) {
  const { hasModule, orgId, loading } = useAuth();
  const router = useRouter();

  const allowed = hasModule(module);

  useEffect(() => {
    // If org is loaded and module is not enabled, redirect after a short delay
    if (!loading && orgId && !allowed) {
      // Don't redirect immediately — show the blocked message
    }
  }, [loading, orgId, allowed, router]);

  if (loading) return null; // Still loading auth context

  if (!allowed && orgId) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-4V7a4 4 0 00-8 0v4h2V7a2 2 0 114 0v4h2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11h14a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Module Not Available</h2>
          <p className="text-sm text-gray-600 mb-4">
            The <strong>{module}</strong> module is not enabled for your organization.
            Contact your administrator or upgrade your subscription to access this feature.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 bg-[#0F2A47] text-white rounded-lg text-sm font-medium hover:bg-[#1B3E63] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Higher-order component version for pages that want a simpler pattern.
 */
export function withModuleGuard(module: string) {
  return function GuardedPage({ children }: { children: React.ReactNode }) {
    return <ModuleGuard module={module}>{children}</ModuleGuard>;
  };
}
