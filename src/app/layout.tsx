import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";

export const metadata: Metadata = {
  title: "LINE PDF Delivery",
  description: "PDF一括取り込み・LINE個別配信システム",
};

// テーマ初期化（FOUC防止のため最優先で実行し、CSS適用前に data-* 属性を確定させる）
// WorkLedger design-spec §12.4 準拠のキー名（wl_theme_mode / wl_color_scheme）を使用。
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var theme = localStorage.getItem('wl_theme_mode');
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var scheme = localStorage.getItem('wl_color_scheme');
    if (scheme !== 'default' && scheme !== 'heroui') scheme = 'default';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-color-scheme', scheme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Header />
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
