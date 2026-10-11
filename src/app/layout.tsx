import type { Metadata } from "next";
import "./styles/globals.css";

const DESCRIPTION = "日本語の約 39 万語を、使われ方の近さで平面に並べました。言葉を探したり、使われ方の近い言葉をたどったりできます。";

export const metadata: Metadata = {
  title: "日本語語彙スカイサーベイ（β版）",
  description: DESCRIPTION,
  // 共有したときに SNS に出る画像（src/app/opengraph-image.png）を、公開先の URL で指すための基準
  metadataBase: new URL("https://goi-sky-survey.lolipop-now.app"),
  // 共有したときの見え方。語ごとに変えず、どの語の URL でも同じ画像と文にする（偏った連想が画像で広がらないように）
  openGraph: { title: "日本語語彙スカイサーベイ", description: DESCRIPTION, type: "website", locale: "ja_JP" },
  twitter: { card: "summary_large_image" },
  // アイコンは置かない。空のアイコンを指定して、ブラウザが /favicon.ico を取りに行って 404 になるのを防ぐ
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
