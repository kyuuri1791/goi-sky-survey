import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ロリポップ！デプロイナウでは standalone 出力が必須
  output: "standalone",
  // 開発中に左下に出る Next.js のマークは、凡例と重なるので出さない（エラーは引き続き表示される）
  devIndicators: false,
  // 検索の索引と単語の情報は実行時に fs で読むので同梱する
  outputFileTracingIncludes: {
    "/api/*": ["./data/index.bin", "./data/meta.json", "./data/neighbors.bin"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
