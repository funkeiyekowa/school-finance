/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["placeholder.supabase.co"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverComponentsExternalPackages: ["jspdf"],
  },
};

export default nextConfig;
