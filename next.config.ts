import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://utinc.dev https://*.utinc.dev https://*.vercel.app",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
