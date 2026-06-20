"use client";

// 各画面（/pdfs・/reminders・/recipients・/history）共通のエラーバウンダリ。
// ルートレイアウト（ヘッダー + globals.css）の内側で描画されるため、
// ヘッダーを残したまま本文だけをエラー表示に差し替える。
// global-error と違い、ここはレイアウトが生きているので CSS 変数を使える。

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page">
      <div
        className="card"
        style={{ maxWidth: 420, margin: "48px auto 0", textAlign: "center" }}
      >
        <div className="card__body" style={{ padding: "28px 24px" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: "var(--text)" }}>
            問題が発生しました
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              margin: "0 0 20px",
              lineHeight: 1.6,
            }}
          >
            このページの読み込み中にエラーが発生しました。
            <br />
            お手数ですが、再試行してください。
          </p>
          {error?.digest && (
            <p
              className="num"
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                margin: "0 0 20px",
                wordBreak: "break-all",
              }}
            >
              {error.digest}
            </p>
          )}
          <button type="button" className="btn btn--primary" onClick={() => reset()}>
            再試行
          </button>
        </div>
      </div>
    </div>
  );
}
