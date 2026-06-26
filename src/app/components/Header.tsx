"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/pdfs", label: "PDF管理" },
  { href: "/reminders", label: "リマインダー" },
  { href: "/recipients", label: "送信先" },
  { href: "/history", label: "送信履歴" },
];

// /api/whoami が返す identity（表示に使う分だけ）。未取得・未付与は null。
type WhoAmI = {
  tenant_name: string | null;
  name: string | null;
  department: string | null;
};

export default function Header() {
  const pathname = usePathname();
  const [time, setTime] = useState("");
  const [embedded, setEmbedded] = useState(false);
  const [who, setWho] = useState<WhoAmI | null>(null);

  useEffect(() => {
    setEmbedded(window.self !== window.top);
    const update = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    };
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  // 起動時に1回だけ /api/whoami を取得し、ヘッダの identity を埋める。
  // 未認証（401）や取得失敗時は who=null のまま＝何も追加表示しない（非破壊）。
  useEffect(() => {
    let alive = true;
    fetch("/api/whoami", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok) return;
        setWho({
          tenant_name: d.tenant_name ?? null,
          name: d.name ?? null,
          department: d.department ?? null,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 表示できる identity があるか（テナント名・氏名・部署のいずれか）。
  const hasIdentity = !!(who && (who.tenant_name || who.name || who.department));

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        height: 48,
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {!embedded && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            LINE PDF
          </span>
        )}

        <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  textDecoration: "none",
                  fontSize: 12.5,
                  fontWeight: isActive ? 600 : 500,
                  padding: "6px 10px",
                  borderRadius: 5,
                  color: isActive ? "var(--text)" : "var(--text-2)",
                  background: isActive ? "var(--surface-2)" : "transparent",
                  transition: "background 0.12s, color 0.12s",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 11.5,
          color: "var(--text-3)",
        }}
      >
        {/* ログイン中の identity（テナント名・氏名・部署）。未取得/未付与なら表示しない。 */}
        {hasIdentity && who && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              maxWidth: 320,
              minWidth: 0,
            }}
          >
            {who.tenant_name && (
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--text-2)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={who.tenant_name}
              >
                {who.tenant_name}
              </span>
            )}
            {(who.name || who.department) && (
              <span
                style={{
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={[who.name, who.department].filter(Boolean).join(" / ")}
              >
                {[who.name, who.department].filter(Boolean).join(" / ")}
              </span>
            )}
          </div>
        )}

        {!embedded && (
          <>
            <span className="num">{time}</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: "var(--text-2)",
              }}
            >
              <span className="dot dot--green" />
              稼働中
            </span>
          </>
        )}
      </div>
    </header>
  );
}
