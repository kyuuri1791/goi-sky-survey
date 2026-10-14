import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ロリポップ！デプロイナウでは standalone 出力が必須
  output: "standalone",
  // 開発中に左下に出る Next.js のマークは、凡例と重なるので出さない(エラーは引き続き表示される)
  devIndicators: false,
  // sqlite-vec は SQLite に読み込ませる拡張(ネイティブのファイル)なので、まとめずに実行時に node_modules から読む
  serverExternalPackages: ["sqlite-vec"],
  // データ(SQLite のファイル)は実行時に読むので同梱する。sqlite-vec の拡張のファイルも、読み込み方が動的で自動では含まれないので足す
  outputFileTracingIncludes: {
    "/api/*": ["./data/*.db", "./node_modules/sqlite-vec-linux-*/**"],
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
