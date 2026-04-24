"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Recipient = {
  id: string;
  displayName: string;
  lineUserId: string;
  memo: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  sortOrder?: number;
};

function IconGrip() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <circle cx="6" cy="3" r="1.2" />
      <circle cx="10" cy="3" r="1.2" />
      <circle cx="6" cy="8" r="1.2" />
      <circle cx="10" cy="8" r="1.2" />
      <circle cx="6" cy="13" r="1.2" />
      <circle cx="10" cy="13" r="1.2" />
    </svg>
  );
}

function SortableRow({
  r,
  onEdit,
  onDeactivate,
  onRemove,
}: {
  r: Recipient;
  onEdit: (r: Recipient) => void;
  onDeactivate: (id: string, name: string) => void;
  onRemove: (id: string, name: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: r.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? "var(--surface-2)" : undefined,
    opacity: isDragging ? 0.7 : undefined,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 5 : undefined,
  };

  const isGroup = (r as Record<string, unknown>).type === "group";

  return (
    <tr ref={setNodeRef} style={style}>
      <td style={{ width: 32, padding: "0 4px" }}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label="並び替え"
          title="ドラッグで並び替え"
          {...attributes}
          {...listeners}
          style={{
            width: 24,
            height: 24,
            border: "none",
            background: "transparent",
            color: "var(--text-mute)",
            cursor: "grab",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            touchAction: "none",
          }}
        >
          <IconGrip />
        </button>
      </td>
      <td>
        <span style={{ fontWeight: 500 }}>{r.displayName}</span>
        {r.isDefault && (
          <span className="badge badge--blue" style={{ marginLeft: 6 }}>
            デフォルト
          </span>
        )}
      </td>
      <td className="td-center">
        <span
          className={`badge ${isGroup ? "badge--purple" : "badge--gray"}`}
        >
          {isGroup ? "グループ" : "個人"}
        </span>
      </td>
      <td
        className="num td-muted truncate"
        style={{ maxWidth: 140, fontSize: 12 }}
      >
        {r.lineUserId}
      </td>
      <td className="td-muted truncate" style={{ maxWidth: 200 }}>
        {r.memo || <span className="text-mute">—</span>}
      </td>
      <td className="td-center">
        {r.isActive ? (
          <span className="badge badge--green">
            <span className="dot dot--green" />
            有効
          </span>
        ) : (
          <span className="badge badge--gray">無効</span>
        )}
      </td>
      <td className="td-right">
        <div style={{ display: "inline-flex", gap: 2 }}>
          <button
            onClick={() => onEdit(r)}
            className="btn btn--ghost btn--sm"
          >
            編集
          </button>
          {r.isActive && (
            <button
              onClick={() => onDeactivate(r.id, r.displayName)}
              className="btn btn--ghost btn--sm"
              style={{ color: "var(--amber)" }}
            >
              無効化
            </button>
          )}
          <button
            onClick={() => onRemove(r.id, r.displayName)}
            className="btn btn--danger btn--sm"
          >
            削除
          </button>
        </div>
      </td>
    </tr>
  );
}

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = recipients.findIndex((r) => r.id === active.id);
    const newIndex = recipients.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(recipients, oldIndex, newIndex);
    const snapshot = recipients;
    setRecipients(next);

    try {
      const res = await fetch("/api/v1/recipients/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((r) => r.id) }),
      });
      if (!res.ok) throw new Error("保存失敗");
    } catch {
      // ロールバック
      setRecipients(snapshot);
      alert("並び替えの保存に失敗しました");
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`「${name}」を無効化しますか？`)) return;
    const res = await fetch(`/api/v1/recipients/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(`無効化に失敗しました: ${data.error || res.statusText}`);
      return;
    }
    fetchRecipients();
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`「${name}」を完全に削除しますか？\n送信履歴・リマインダー・ルーティングルールも全て削除されます。この操作は取り消せません。`)) return;
    const res = await fetch(`/api/v1/recipients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _delete: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `削除に失敗しました (${res.status})`);
      return;
    }
    fetchRecipients();
  };

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">送信先管理</h1>
          <p className="page__sub">LINEの送信先を登録・管理します。行頭の6点アイコンをドラッグで並び替えできます。</p>
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} aria-label="並び替え" />
                    <th>表示名</th>
                    <th className="th-center">種別</th>
                    <th>LINE ID</th>
                    <th>メモ</th>
                    <th className="th-center">状態</th>
                    <th className="th-right">操作</th>
                  </tr>
                </thead>
                <SortableContext
                  items={recipients.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {recipients.map((r) => (
                      <SortableRow
                        key={r.id}
                        r={r}
                        onEdit={(rcp) => { setEditTarget(rcp); setShowForm(true); }}
                        onDeactivate={handleDeactivate}
                        onRemove={handleRemove}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
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
