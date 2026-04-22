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

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Recipient | null>(null);

  const fetchRecipients = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/v1/recipients");
    const data = await res.json();
    setRecipients(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRecipients();
  }, [fetchRecipients]);

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`「${name}」を無効化しますか？`)) return;
    await fetch(`/api/v1/recipients/${id}`, { method: "DELETE" });
    fetchRecipients();
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`「${name}」を完全に削除しますか？ この操作は取り消せません。`)) return;
    await fetch(`/api/v1/recipients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _delete: true }),
    });
    fetchRecipients();
  };

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">送信先管理</h1>
          <p className="page__sub">LINEの送信先を登録・管理します。</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="btn btn--primary"
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
        <div className="empty">読み込み中…</div>
      ) : recipients.length === 0 ? (
        <div className="empty">送信先が登録されていません。「新規登録」から追加してください。</div>
      ) : (
        <div className="card">
          <div className="card__body card__body--flush" style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>表示名</th>
                  <th className="th-center">種別</th>
                  <th>LINE ID</th>
                  <th>メモ</th>
                  <th className="th-center">状態</th>
                  <th className="th-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => {
                  const isGroup = (r as Record<string, unknown>).type === "group";
                  return (
                    <tr key={r.id}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{r.displayName}</span>
                        {r.isDefault && <span className="badge badge--blue" style={{ marginLeft: 6 }}>デフォルト</span>}
                      </td>
                      <td className="td-center">
                        <span className={`badge ${isGroup ? "badge--purple" : "badge--gray"}`}>
                          {isGroup ? "グループ" : "個人"}
                        </span>
                      </td>
                      <td className="num td-muted truncate" style={{ maxWidth: 140, fontSize: 12 }}>
                        {r.lineUserId}
                      </td>
                      <td className="td-muted truncate" style={{ maxWidth: 200 }}>
                        {r.memo || <span className="text-mute">—</span>}
                      </td>
                      <td className="td-center">
                        {r.isActive ? (
                          <span className="badge badge--green"><span className="dot dot--green" />有効</span>
                        ) : (
                          <span className="badge badge--gray">無効</span>
                        )}
                      </td>
                      <td className="td-right">
                        <div style={{ display: "inline-flex", gap: 2 }}>
                          <button onClick={() => { setEditTarget(r); setShowForm(true); }} className="btn btn--ghost btn--sm">編集</button>
                          {r.isActive && (
                            <button onClick={() => handleDeactivate(r.id, r.displayName)} className="btn btn--ghost btn--sm" style={{ color: "var(--amber)" }}>無効化</button>
                          )}
                          <button onClick={() => handleRemove(r.id, r.displayName)} className="btn btn--danger btn--sm">削除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

    const url = isEdit ? `/api/v1/recipients/${target.id}` : "/api/v1/recipients";
    const method = isEdit ? "PATCH" : "POST";
    const body = isEdit
      ? { displayName, memo: memo || null, isDefault }
      : { displayName, lineUserId, memo: memo || null, isDefault };

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "保存に失敗しました");
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(`通信エラー: ${err instanceof Error ? err.message : "不明"}`);
      setSaving(false);
    }
  };

  return (
    <div className="modal__backdrop" onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="modal modal--wide"
      >
        <div className="modal__head">
          <div className="modal__title">{isEdit ? "送信先の編集" : "新規送信先"}</div>
        </div>
        <div className="modal__body">
          {error && <div className="alert alert--red">{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label className="field__label">表示名 <span style={{ color: "var(--red)" }}>*</span></label>
              <input type="text" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="山田太郎" required />
            </div>
            <div className="field">
              <label className="field__label">LINE User ID <span style={{ color: "var(--red)" }}>*</span></label>
              <input type="text" className="input num" value={lineUserId} onChange={(e) => setLineUserId(e.target.value)} placeholder="U1234567890..." required disabled={isEdit} />
              {isEdit && <p className="field__help">変更不可</p>}
            </div>
          </div>

          <div className="field">
            <label className="field__label">メモ</label>
            <input type="text" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意のメモ" />
          </div>

          <label className="toggle" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            <span className="toggle__track"><span className="toggle__thumb" /></span>
            <span className="toggle__label">デフォルト送信先に設定</span>
          </label>
        </div>

        <div className="modal__foot">
          <button type="button" onClick={onCancel} className="btn">キャンセル</button>
          <button type="submit" disabled={saving} className="btn btn--primary">
            {saving ? "保存中…" : isEdit ? "更新する" : "登録する"}
          </button>
        </div>
      </form>
    </div>
  );
}
