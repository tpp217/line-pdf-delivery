import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LINE PDF DELIVERY",
  description: "PDF一括取り込み・LINE個別配信システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: "#0a0a0f", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>
        {children}
      </body>
    </html>
  );
}
