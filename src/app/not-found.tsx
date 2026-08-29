import Link from "next/link";

/**
 * Global 404 page. Replaces Next's bare default so a mistyped URL
 * lands somewhere branded with a way back.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F7F5F0",
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: "#C9A227", lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F2A47", margin: "12px 0 6px" }}>
          Page not found
        </h1>
        <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px" }}>
          The page you were looking for doesn&apos;t exist or has moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            background: "#0F2A47",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
