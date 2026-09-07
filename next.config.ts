import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // nodemailer は Node の net/tls を直接使う。バンドルさせずにそのまま読む
  serverExternalPackages: ["nodemailer"],
  experimental: {
    /*
      直前に見たタブに戻ったとき、サーバへ問い合わせ直さない秒数。
      既定は 0 なので、2秒前に見たページへ戻るだけでも毎回往復していた。

      自分の保存操作は revalidatePath がこのキャッシュも捨てるので即座に
      反映される。遅れて見えるのは「別の端末で入れた変更」と「毎朝の cron が
      入れた記録」だけで、それも最大30秒。
    */
    staleTimes: { dynamic: 30 },
  },
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
