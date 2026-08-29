"use client";

/**
 * Root error boundary.
 *
 * Catches errors thrown by the root layout itself — the one place the
 * segment-level error.tsx cannot cover, because it renders inside that
 * layout. It must therefore render its own <html>/<body>. Kept
 * deliberately dependency-free (no shared components, no fonts) so it
 * still renders even if the failure is in the layout's own imports.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#F7F5F0",
          color: "#0F2A47",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px" }}>
            Please reload the page. If this keeps happening, contact your
            administrator.
          </p>
          {error?.digest && (
            <p style={{ fontSize: 11, fontFamily: "monospace", color: "#9ca3af", margin: "0 0 20px" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: "#0F2A47",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
