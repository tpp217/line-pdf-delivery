"use client";
import Link from "next/link";

const navItems = [
  { href: "/pdfs", label: "PDF管理", desc: "アップロード・カテゴリ管理・LINE送信", icon: "◈" },
  { href: "/reminders", label: "リマインダー", desc: "定期テキストの自動LINE送信", icon: "◎" },
  { href: "/recipients", label: "送信先管理", desc: "LINEユーザーの登録・編集", icon: "◉" },
];

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(0,255,255,0.25)",
  borderRadius: "6px",
  padding: "1.25rem",
  background: "#0d1117",
  transition: "border-color 0.2s, box-shadow 0.2s",
  display: "block",
  cursor: "pointer",
};

export default function Home() {
  return (
    <main style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      background: "#0a0a0f",
      minHeight: "100vh",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    }}>
      <div style={{ marginBottom: "2.5rem", textAlign: "center" }}>
        <p style={{
          fontSize: "0.7rem",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "#00ffff",
          marginBottom: "0.5rem",
        }}>
          LINE PDF DELIVERY SYSTEM
        </p>
        <h1 style={{
          fontSize: "2.5rem",
          fontWeight: "bold",
          letterSpacing: "0.25em",
          color: "#00ffff",
          textShadow: "0 0 20px rgba(0,255,255,0.6), 0 0 40px rgba(0,255,255,0.3)",
          margin: 0,
        }}>
          LPD
        </h1>
        <p style={{ fontSize: "0.75rem", marginTop: "0.5rem", color: "#4a5568" }}>
          PDF一括取り込み → LINE個別配信
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        width: "100%",
        maxWidth: "640px",
      }}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
            <div
              style={cardStyle}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.borderColor = "#00ffff";
                el.style.boxShadow = "0 0 12px rgba(0,255,255,0.4)";
                el.style.background = "rgba(0,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.borderColor = "rgba(0,255,255,0.25)";
                el.style.boxShadow = "none";
                el.style.background = "#0d1117";
              }}
            >
              <div style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "#00ffff" }}>
                {item.icon}
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.25rem", color: "#e2e8f0" }}>
                {item.label}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#4a5568" }}>
                {item.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: "3rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.65rem", color: "#4a5568", letterSpacing: "0.12em" }}>
          v1.0 // SYSTEM ONLINE
        </p>
      </div>
    </main>
  );
}
