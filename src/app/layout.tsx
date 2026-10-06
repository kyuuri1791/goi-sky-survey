import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日本語語彙スカイサーベイ（β版）",
  description: "日本語の約 39 万語を、使われ方の近さで平面に並べました。言葉を探したり、意味の近い言葉をたどったりできます。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
