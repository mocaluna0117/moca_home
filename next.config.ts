import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon — it must not be bundled by webpack/turbopack.
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "20and20.pet",
        pathname: "/store/html/upload/save_image/**",
      },
    ],
  },
};

export default nextConfig;
