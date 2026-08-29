/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // SWC is faster than Terser and enabled by default in 14, but be explicit.
  swcMinify: true,

  // Drop the extra HTTP header — 1 fewer byte per response, thousands per day.
  poweredByHeader: false,

  // Gzip is on by default when Next serves, but this ensures it in
  // custom-serve environments (Vercel already compresses).
  compress: true,

  // Trim runtime by tree-shaking these barrel packages more aggressively.
  // lucide-react and date-fns are the two biggest offenders — each icon
  // used to pull the whole package into the bundle. modularizeImports
  // rewrites `import { X } from "lucide-react"` into a direct file import.
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
      preventFullImport: true,
    },
    "date-fns": {
      transform: "date-fns/{{member}}",
      preventFullImport: true,
    },
  },

  // Experimental optimizations that ship stable in 14.2.
  experimental: {
    // Server actions cache invalidation gets its own cache; safe.
    serverActions: { bodySizeLimit: "2mb" },
    // Inline critical CSS to shave a request off first-paint.
    optimizeCss: false, // pinned OFF — turning this on requires `critters` in deps
    // Smaller React runtime by hoisting shared hooks across islands.
    optimizePackageImports: ["recharts", "date-fns", "lucide-react", "@supabase/ssr", "@supabase/supabase-js"],
  },

  // NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are read
  // from the environment (.env.local locally, Vercel env in prod) — no
  // hardcoded fallbacks here so a missing config fails loudly at build
  // time instead of silently shipping stale credentials. The anon key
  // is safe to expose in the browser (that's what it's for) but pinning
  // it to a specific project made it impossible to rotate without a
  // code push.

  images: {
    // Allow the supabase asset host + unsplash (used on the landing page).
    remotePatterns: [
      { protocol: "https", hostname: "dqlsdocmjudzyzmqisrx.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
    // Aggressive default TTL — most school photos don't change often.
    minimumCacheTTL: 60 * 60 * 24, // 1 day
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  // Set aggressive edge-cache defaults for the marketing landing page.
  // Everything under /dashboard is user-scoped so no shared caching.
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
        ],
      },
      {
        // SEO — teach crawlers to index our site.
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
