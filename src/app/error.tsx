"use client";

/**
 * Route-segment error boundary.
 *
 * Next.js renders this whenever a client or server component below the
 * root layout throws during render. Without it, an uncaught error shows
 * a blank screen in production. This gives the user a recovery path
 * (retry the segment, or go home) and logs the error for diagnostics.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console (and any attached monitoring) so the
    // failure isn't silent. `digest` is Next's stable error id.
    // eslint-disable-next-line no-console
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-5">
          <AlertTriangle className="text-red-500" size={26} />
        </div>
        <h1 className="text-xl font-bold text-[#0F2A47]">Something went wrong</h1>
        <p className="text-sm text-gray-500 mt-2">
          This screen hit an unexpected error. You can try again, or head back
          to your dashboard. Nothing you entered has been lost.
        </p>
        {error?.digest && (
          <p className="mt-3 text-[11px] font-mono text-gray-400">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F2A47] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1B3E63] transition-colors"
          >
            <RefreshCw size={15} /> Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-[#0F2A47] hover:bg-gray-50 transition-colors"
          >
            <Home size={15} /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
