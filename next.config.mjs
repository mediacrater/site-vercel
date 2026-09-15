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
        destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*`,
      },
    ];
  },
}

export default nextConfig
