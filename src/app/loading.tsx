// 画面遷移中に即座に表示するスケルトン。
// 全主要画面（/pdfs・/reminders・/recipients・/history）は共通の
// `.page` コンテナ（max-width 1400px / padding 18px 24px）を使うため、
// ここで外枠・見出し・カードのプレースホルダーを描いてレイアウトずれを抑える。
// 装飾は付けず、ニュートラルなグレーの点滅ブロックのみ（実用性優先）。

function Block({
  width,
  height,
  radius = 6,
}: {
  width: number | string;
  height: number;
  radius?: number;
}) {
  return (
    <div
      className="animate-pulse"
      style={{
        width,
        height,
        borderRadius: radius,
        background: "var(--surface-3)",
      }}
    />
  );
}

export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="読み込み中">
      {/* 見出し行 */}
      <div className="page__head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Block width={180} height={24} />
          <Block width={320} height={13} />
        </div>
        <Block width={120} height={28} />
      </div>

      {/* ツールバー（フィルタ行）相当 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Block width={96} height={26} />
        <Block width={96} height={26} />
        <Block width={128} height={26} />
      </div>

      {/* カード／テーブル相当 */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "11px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Block width={140} height={14} />
          <Block width={64} height={14} />
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <Block width={16} height={16} radius={4} />
              <Block width="32%" height={13} />
              <Block width="18%" height={13} />
              <Block width="14%" height={13} />
              <div style={{ marginLeft: "auto" }}>
                <Block width={72} height={24} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
