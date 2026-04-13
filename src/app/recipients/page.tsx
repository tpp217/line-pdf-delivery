"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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
    <main className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">
            ← ホーム
          </Link>
          <h1 className="text-xl font-bold mt-1">送信先管理</h1>
        </div>
        <button
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors"
        >
          + 新規登録
        </button>
      </div>

      {showForm && (
        <RecipientForm
          target={editTarget}
          onDone={() => {
            setShowForm(false);
            setEditTarget(null);
            fetchRecipients();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditTarget(null);
          }}
        />
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中...</p>
      ) : recipients.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          送信先が登録されていません。「新規登録」から追加してください。
        </p>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                <th className="text-left p-3">表示名</th>
                <th className="text-left p-3">LINE User ID</th>
                <th className="text-left p-3">メモ</th>
                <th className="text-center p-3">状態</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {recipients.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  <td className="p-3 font-medium">
                    {r.displayName}
                    {r.isDefault && (
                      <span className="ml-2 text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">
                        デフォルト
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs text-zinc-400">
                    {r.lineUserId}
                  </td>
                  <td className="p-3 text-zinc-500 text-xs max-w-48 truncate">
                    {r.memo || "-"}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        r.isActive
                          ? "bg-emerald-900/50 text-emerald-400"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {r.isActive ? "有効" : "無効"}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => {
                        setEditTarget(r);
                        setShowForm(true);
                      }}
                      className="text-xs text-zinc-400 hover:text-zinc-100"
                    >
                      編集
                    </button>
                    {r.isActive ? (
                      <button
                        onClick={() => handleDeactivate(r.id, r.displayName)}
                        className="text-xs text-zinc-500 hover:text-yellow-400"
                      >
                        無効化
                      </button>
                    ) : null}
                    <button
                      onClick={() => handleRemove(r.id, r.displayName)}
                      className="text-xs text-zinc-500 hover:text-red-400"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
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

    const url = isEdit
      ? `/api/v1/recipients/${target.id}`
      : "/api/v1/recipients";
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

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500";

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-zinc-700 rounded-lg p-5 mb-6 bg-zinc-900/50"
    >
      <h2 className="text-sm font-semibold mb-4">
        {isEdit ? "送信先の編集" : "新規送信先"}
      </h2>

      {error && (
        <p className="text-red-400 text-xs mb-3 bg-red-900/20 border border-red-900/50 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">表示名 *</label>
          <input
            type="text"
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: 山田太郎"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            LINE User ID *
          </label>
          <input
            type="text"
            className={inputClass}
            value={lineUserId}
            onChange={(e) => setLineUserId(e.target.value)}
            placeholder="例: U1234567890abcdef..."
            required
            disabled={isEdit}
          />
          {isEdit && (
            <p className="text-xs text-zinc-600 mt-1">
              LINE User ID は変更できません
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-zinc-400 mb-1">メモ</label>
        <input
          type="text"
          className={inputClass}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="任意のメモ"
        />
      </div>

      <div className="mb-5">
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="rounded border-zinc-600"
          />
          デフォルト送信先に設定
        </label>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors disabled:opacity-50"
        >
          {saving ? "保存中..." : isEdit ? "更新" : "登録"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
