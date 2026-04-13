"use client";
import Link from "next/link";

const navItems = [
  { href: "/pdfs", label: "PDF管理", desc: "PDF取り込み・カテゴリ管理・LINE送信", icon: "◈" },
  { href: "/reminders", label: "リマインダー", desc: "定期テキストの自動LINE送信", icon: "◎" },
  { href: "/recipients", label: "送信先管理", desc: "LINEユーザーの登録・編集", icon: "◉" },
];

function HudCorners({ color = "rgba(0,255,255,0.6)" }: { color?: string }) {
  const size = 8;
  const corners = [
    { top: 0, left: 0, borderWidth: "1px 0 0 1px" },
    { top: 0, right: 0, borderWidth: "1px 1px 0 0" },
    { bottom: 0, left: 0, borderWidth: "0 0 1px 1px" },
    { bottom: 0, right: 0, borderWidth: "0 1px 1px 0" },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <span key={i} style={{ position: "absolute", width: size, height: size, borderStyle: "solid", borderColor: color, ...c }} />
      ))}
    </>
  );
}

export default function Home() {
  const clipMd = "polygon(10px 0%, 100% 0%, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0% 100%, 0% 10px)";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* メイン */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 2rem" }}>
        <div style={{ marginBottom: "3rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.75rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,255,255,0.5)", marginBottom: "0.5rem" }}>
            LINE PDF DELIVERY SYSTEM
          </p>
          <h1 style={{ fontSize: "3rem", fontWeight: "bold", letterSpacing: "0.3em", color: "#00ffff", textShadow: "0 0 20px rgba(0,255,255,0.6), 0 0 50px rgba(0,255,255,0.2)", margin: "0 0 0.5rem" }}>
            LPD
          </h1>
          <div style={{ width: "120px", height: "1px", background: "linear-gradient(90deg, transparent, #00ffff, transparent)", margin: "0 auto 0.75rem" }} />
          <p style={{ fontSize: "0.8rem", color: "#718096", letterSpacing: "0.05em" }}>
            PDF一括取り込み → LINE個別配信
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem", width: "100%", maxWidth: "680px" }}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <div
                style={{ position: "relative", clipPath: clipMd, background: "#0d1117", border: "1px solid rgba(0,255,255,0.25)", padding: "1.5rem 1.25rem", cursor: "pointer", transition: "border-color 0.2s, box-shadow 0.2s", height: "140px", display: "flex", flexDirection: "column", justifyContent: "flex-start" }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = "#00ffff";
                  el.style.boxShadow = "0 0 16px rgba(0,255,255,0.3), inset 0 0 20px rgba(0,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = "rgba(0,255,255,0.25)";
                  el.style.boxShadow = "none";
                }}
              >
                <HudCorners />
                <div style={{ fontSize: "1.4rem", marginBottom: "0.6rem", color: "#00ffff", textShadow: "0 0 8px rgba(0,255,255,0.6)" }}>
                  {item.icon}
                </div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.4rem", color: "#e2e8f0", letterSpacing: "0.05em" }}>
                  {item.label}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#718096", lineHeight: 1.5 }}>
                  {item.desc}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* フッター */}
      <footer style={{ borderTop: "1px solid rgba(0,255,255,0.1)", padding: "0.5rem 1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.7rem", color: "#718096", letterSpacing: "0.12em" }}>
          v1.0 // SYSTEM ONLINE
        </p>
      </footer>
    </div>
  );
}
