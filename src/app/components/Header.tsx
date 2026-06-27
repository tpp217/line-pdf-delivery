"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isStandaloneClient } from "@/lib/app-mode";

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

        {/* 認証アイコン（再ログイン / ログアウト）。iframe 埋め込み時は出さない。 */}
        {!embedded && <AuthIcons />}
      </div>
    </header>
  );
}

// 画面右上の認証アイコン（全システム共通の雛形）。文字ラベルは付けずアイコンのみ。
//   - 再ログイン（↻）: 表示/トークンを最新に刷り直す。
//       プラットフォーム版 → wh SSO 入口 /auth/login（ログイン済みなら無音で再 mint）。
//       単体版          → 自前ログイン /login（Supabase Auth）。
//   - ログアウト（⇥）: セッションを破棄して入口へ戻る。
//       プラットフォーム版 → /auth/signout（wh_token cookie を失効させて入口へ 303）。
//       単体版          → /auth/signout（加えて Supabase Auth を signOut）。
// モード判定はクライアント側 NEXT_PUBLIC_STANDALONE を参照（既定＝プラットフォーム）。
function AuthIcons() {
  const standalone = isStandaloneClient();
  // プラットフォーム版は wh SSO 入口 /auth/login（再ログインなしで無音再 mint）。
  // 単体版は自前ログイン /login（Supabase Auth）。
  const reloginHref = standalone ? "/login" : "/auth/login";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* 再ログイン（更新の循環矢印） */}
      <a
        href={reloginHref}
        title="再ログイン"
        aria-label="再ログイン"
        style={authIconBtnStyle}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </a>
      {/* ログアウト（退出の矢印）。POST で確実にセッション破棄する */}
      <form
        action="/auth/signout"
        method="post"
        style={{ margin: 0, display: "inline-flex" }}
      >
        <button
          type="submit"
          title="ログアウト"
          aria-label="ログアウト"
          style={authIconBtnStyle}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </form>
    </div>
  );
}

const authIconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid var(--border)",
  color: "var(--text-2)",
  background: "transparent",
  cursor: "pointer",
  textDecoration: "none",
};
