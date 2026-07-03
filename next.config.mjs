/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/db/:path*",
        destination: "https://wwnpgzgvwsbdipysvobb.supabase.co/:path*",
      },
    ];
  },
}

export default nextConfig
