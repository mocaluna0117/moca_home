import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
