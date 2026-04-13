"use client";

import { useEffect, useState, useCallback } from "react";

type Recipient = {
  id: string;
  displayName: string;
  lineUserId: string;
  memo: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
};

const S = {
  page: { padding: "1.5rem" } as React.CSSProperties,
  wrap: { maxWidth: "900px", margin: "0 auto" } as React.CSSProperties,
  heading: { fontSize: "1.2rem", fontWeight: "bold", color: "#e2e8f0", margin: 0, letterSpacing: "0.05em" } as React.CSSProperties,
  btnCyan: { background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "0.35rem 1rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", letterSpacing: "0.05em" } as React.CSSProperties,
  btnGhost: { background: "transparent", border: "1px solid #718096", color: "#718096", padding: "0.35rem 1rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" } as React.CSSProperties,
  btnText: { background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", padding: "0.2rem 0.4rem" } as React.CSSProperties,
  btnDanger: { background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", padding: "0.2rem 0.4rem" } as React.CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "0.8rem" },
  th: { background: "#111827", color: "#00ffff", fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: "0.6rem 0.75rem", borderBottom: "1px solid rgba(0,255,255,0.2)", textAlign: "left" as const },
  td: { padding: "0.6rem 0.75rem", color: "#e2e8f0", borderBottom: "1px solid rgba(0,255,255,0.07)" },
  tdMuted: { padding: "0.6rem 0.75rem", color: "#718096", borderBottom: "1px solid rgba(0,255,255,0.07)", fontSize: "0.75rem" },
  badgeCyan: { border: "1px solid #00ffff", color: "#00ffff", fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "rgba(0,255,255,0.06)", marginLeft: "0.4rem" } as React.CSSProperties,
  badgeGreen: { border: "1px solid #00ff41", color: "#00ff41", fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "rgba(0,255,65,0.06)" } as React.CSSProperties,
  badgeMuted: { border: "1px solid #718096", color: "#718096", fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "transparent" } as React.CSSProperties,
  badgeBlue: { border: "1px solid #60a5fa", color: "#60a5fa", fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "rgba(96,165,250,0.06)" } as React.CSSProperties,
  tableWrap: { border: "1px solid rgba(0,255,255,0.15)", borderRadius: "6px", overflow: "hidden" } as React.CSSProperties,
  emptyText: { color: "#718096", fontSize: "0.8rem" } as React.CSSProperties,
};

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Recipient | null>(null);

  const fetchRecipients = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/lpd/api/v1/recipients");
    const data = await res.json();
    setRecipients(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRecipients();
  }, [fetchRecipients]);

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`「${name}」を無効化しますか？`)) return;
    await fetch(`/lpd/api/v1/recipients/${id}`, { method: "DELETE" });
    fetchRecipients();
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`「${name}」を完全に削除しますか？ この操作は取り消せません。`)) return;
    await fetch(`/lpd/api/v1/recipients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _delete: true }),
    });
    fetchRecipients();
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={S.heading}>送信先管理</h1>
          </div>
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            style={S.btnCyan}
          >
            + 新規登録
          </button>
        </div>

        {showForm && (
          <RecipientForm
            target={editTarget}
            onDone={() => { setShowForm(false); setEditTarget(null); fetchRecipients(); }}
            onCancel={() => { setShowForm(false); setEditTarget(null); }}
          />
        )}

        {loading ? (
          <p style={S.emptyText}>読み込み中...</p>
        ) : recipients.length === 0 ? (
          <p style={S.emptyText}>送信先が登録されていません。「新規登録」から追加してください。</p>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>表示名</th>
                  <th style={{ ...S.th, textAlign: "center" }}>種別</th>
                  <th style={S.th}>LINE ID</th>
                  <th style={S.th}>メモ</th>
                  <th style={{ ...S.th, textAlign: "center" }}>状態</th>
                  <th style={{ ...S.th, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td style={S.td}>
                      {r.displayName}
                      {r.isDefault && <span style={S.badgeCyan}>デフォルト</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <span style={(r as Record<string, unknown>).type === "group" ? S.badgeBlue : S.badgeMuted}>
                        {(r as Record<string, unknown>).type === "group" ? "グループ" : "個人"}
                      </span>
                    </td>
                    <td style={{ ...S.tdMuted, fontFamily: "monospace", maxWidth: "8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.lineUserId}
                    </td>
                    <td style={{ ...S.tdMuted, maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.memo || "-"}
                    </td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <span style={r.isActive ? S.badgeGreen : S.badgeMuted}>
                        {r.isActive ? "有効" : "無効"}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button onClick={() => { setEditTarget(r); setShowForm(true); }} style={S.btnText}>編集</button>
                      {r.isActive && (
                        <button onClick={() => handleDeactivate(r.id, r.displayName)} style={{ ...S.btnText, color: "#f59e0b" }}>無効化</button>
                      )}
                      <button onClick={() => handleRemove(r.id, r.displayName)} style={{ ...S.btnDanger, color: "#ef4444" }}>削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RecipientForm({
  target,
  onDone,
  onCancel,
}: {
  target: Recipient | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(target?.displayName ?? "");
  const [lineUserId, setLineUserId] = useState(target?.lineUserId ?? "");
  const [memo, setMemo] = useState(target?.memo ?? "");
  const [isDefault, setIsDefault] = useState(target?.isDefault ?? false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!target;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    const url = isEdit ? `/lpd/api/v1/recipients/${target.id}` : "/lpd/api/v1/recipients";
    const method = isEdit ? "PATCH" : "POST";
    const body = isEdit
      ? { displayName, memo: memo || null, isDefault }
      : { displayName, lineUserId, memo: memo || null, isDefault };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "保存に失敗しました");
      setSaving(false);
      return;
    }
    onDone();
  };

  const inputStyle: React.CSSProperties = {
    background: "#111827",
    border: "1px solid rgba(0,255,255,0.2)",
    color: "#e2e8f0",
    borderRadius: "4px",
    padding: "0.45rem 0.75rem",
    fontSize: "0.8rem",
    width: "100%",
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0d1117", border: "1px solid #00ffff", boxShadow: "0 0 8px rgba(0,255,255,0.4)", borderRadius: "6px", padding: "1.5rem", width: "26rem", maxHeight: "90vh", overflowY: "auto", fontFamily: "'JetBrains Mono','Courier New',monospace" }}
      >
        <h2 style={{ color: "#00ffff", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.25rem", borderBottom: "1px solid rgba(0,255,255,0.2)", paddingBottom: "0.5rem" }}>
          {isEdit ? "送信先の編集" : "新規送信先"}
        </h2>

        {error && (
          <p style={{ color: "#f87171", fontSize: "0.75rem", marginBottom: "0.75rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", padding: "0.4rem 0.75rem" }}>
            {error}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>表示名 *</label>
            <input type="text" style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="山田太郎" required />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>LINE User ID *</label>
            <input type="text" style={{ ...inputStyle, opacity: isEdit ? 0.5 : 1 }} value={lineUserId} onChange={(e) => setLineUserId(e.target.value)} placeholder="U1234567890..." required disabled={isEdit} />
            {isEdit && <p style={{ fontSize: "0.7rem", color: "#718096", marginTop: "0.25rem" }}>変更不可</p>}
          </div>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>メモ</label>
          <input type="text" style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意のメモ" />
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "#e2e8f0", cursor: "pointer" }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            デフォルト送信先に設定
          </label>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="submit" disabled={saving} style={{ background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "0.4rem 1.25rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", opacity: saving ? 0.5 : 1 }}>
            {saving ? "保存中..." : isEdit ? "更新" : "登録"}
          </button>
          <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
