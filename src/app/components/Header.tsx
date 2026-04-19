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
    const update = () =>
      setTime(
        new Date()
          .toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
          .replace(/\//g, ".")
      );
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header
      style={{
        borderBottom: "1px solid rgba(0,255,255,0.2)",
        padding: "0 1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(0,255,255,0.03)",
        boxShadow: "0 2px 20px rgba(0,255,255,0.08)",
        height: "3rem",
        flexShrink: 0,
      }}
    >
      {/* 左: システム名 + ナビ */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        {!embedded && (
          <span
            style={{
              color: "#00ffff",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
              fontWeight: 700,
            }}
          >
            LPD
          </span>
        )}

        <nav style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  textDecoration: "none",
                  fontSize: "0.75rem",
                  padding: "0.35rem 0.65rem",
                  borderRadius: "4px",
                  color: isActive ? "#00ffff" : "#718096",
                  background: isActive
                    ? "rgba(0,255,255,0.08)"
                    : "transparent",
                  borderBottom: isActive
                    ? "2px solid #00ffff"
                    : "2px solid transparent",
                  transition: "color 0.15s, background 0.15s",
                  letterSpacing: "0.04em",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* 右: 時刻・ステータス (iframe埋め込み時はHUBと重複するので非表示) */}
      {!embedded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.5rem",
            fontSize: "0.7rem",
            color: "#718096",
          }}
        >
          <span>
            <span style={{ color: "#00ffff" }}>{time}</span>
          </span>
          <span style={{ color: "#00ff41" }}>● ONLINE</span>
        </div>
      )}
    </header>
  );
}
