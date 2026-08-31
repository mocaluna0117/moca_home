import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // nodemailer は Node の net/tls を直接使う。バンドルさせずにそのまま読む
  serverExternalPackages: ["nodemailer"],
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
