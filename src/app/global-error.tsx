"use client";

// アプリ全体のエラーバウンダリ。ルートレイアウトを置き換えるため
// 自前で <html>/<body> を描く。globals.css は読み込まれない可能性があるので
// スタイルはインラインで自己完結させ、テーマ色（ニュートラル + 青）を踏襲する。
// 真っ白な画面（ホワイトスクリーン）を防ぎ、再試行できるようにするのが目的。

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FAFBFC",
          color: "#1A1F24",
          fontFamily:
            '"Inter", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic Medium", sans-serif',
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#FFFFFF",
            border: "1px solid #E4E8EC",
            borderRadius: 8,
            padding: "28px 24px",
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(17, 24, 39, 0.04)",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
            問題が発生しました
          </h1>
          <p style={{ fontSize: 13, color: "#5B6672", margin: "0 0 20px", lineHeight: 1.6 }}>
            画面の表示中にエラーが発生しました。
            <br />
            お手数ですが、再読み込みをお試しください。
          </p>
          {error?.digest && (
            <p
              style={{
                fontSize: 11,
                color: "#8C96A1",
                fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
                margin: "0 0 20px",
                wordBreak: "break-all",
              }}
            >
              {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              padding: "0 16px",
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              background: "#2563EB",
              border: "1px solid #2563EB",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            再読み込み
          </button>
        </div>
      </body>
    </html>
  );
}
