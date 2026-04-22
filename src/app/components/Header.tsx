"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/pdfs", label: "PDF管理" },
  { href: "/reminders", label: "リマインダー" },
  { href: "/recipients", label: "送信先" },
];

export default function Header() {
  const pathname = usePathname();
  const [time, setTime] = useState("");
  const [embedded, setEmbedded] = useState(false);

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

      {!embedded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 11.5,
            color: "var(--text-3)",
          }}
        >
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
        </div>
      )}
    </header>
  );
}
