"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Recipient = {
  id: string;
  displayName: string;
  lineUserId: string;
  isActive: boolean;
};

type RoutingRule = {
  id: string;
  matchType: string;
  companyKey: string;
  recipientId: string;
  recipient: Recipient | null;
  priority: number;
  isActive: boolean;
  lastHitAt: string | null;
  createdAt: string;
};

export default function RoutingRulesPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RoutingRule | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [rulesRes, recipientsRes] = await Promise.all([
      fetch("/api/v1/routing-rules"),
      fetch("/api/v1/recipients"),
    ]);
    setRules(await rulesRes.json());
    setRecipients(await recipientsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: string, key: string) => {
    if (!confirm(`ルール「${key}」を削除しますか？`)) return;
    await fetch(`/api/v1/routing-rules/${id}`, { method: "DELETE" });
    fetchData();
  };

  const handleToggle = async (rule: RoutingRule) => {
    await fetch(`/api/v1/routing-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    fetchData();
  };

  const matchTypeLabel: Record<string, string> = {
    EXACT: "完全一致",
    CONTAINS: "部分一致",
    REGEX: "正規表現",
  };

  return (
    <main className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">
            ← ホーム
          </Link>
          <h1 className="text-xl font-bold mt-1">ルーティングルール</h1>
          <p className="text-zinc-500 text-xs mt-1">
            氏名キーワード → 送信先LINEユーザーのマッピング
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors"
        >
          + ルール追加
        </button>
      </div>

      {showForm && (
        <RuleForm
          target={editTarget}
          recipients={recipients}
          onDone={() => { setShowForm(false); setEditTarget(null); fetchData(); }}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中...</p>
      ) : rules.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          ルールがありません。「ルール追加」で氏名と送信先の対応を登録してください。
        </p>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                <th className="text-left p-3">キーワード</th>
                <th className="text-left p-3">マッチ</th>
                <th className="text-left p-3">送信先</th>
                <th className="text-center p-3">優先度</th>
                <th className="text-center p-3">状態</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rules.map((rule) => (
                <tr key={rule.id} className={`hover:bg-zinc-900/50 ${!rule.isActive ? "opacity-50" : ""}`}>
                  <td className="p-3 font-medium">{rule.companyKey}</td>
                  <td className="p-3 text-xs text-zinc-400">
                    {matchTypeLabel[rule.matchType] || rule.matchType}
                  </td>
                  <td className="p-3 text-xs">
                    {rule.recipient?.displayName || (
                      <span className="text-zinc-600">不明</span>
                    )}
                  </td>
                  <td className="p-3 text-center text-xs text-zinc-400">
                    {rule.priority}
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={`text-xs px-2 py-0.5 rounded cursor-pointer ${
                        rule.isActive
                          ? "bg-emerald-900/50 text-emerald-400"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {rule.isActive ? "有効" : "無効"}
                    </button>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => { setEditTarget(rule); setShowForm(true); }}
                      className="text-xs text-zinc-400 hover:text-zinc-100"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id, rule.companyKey)}
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

function RuleForm({
  target,
  recipients,
  onDone,
  onCancel,
}: {
  target: RoutingRule | null;
  recipients: Recipient[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [companyKey, setCompanyKey] = useState(target?.companyKey ?? "");
  const [matchType, setMatchType] = useState(target?.matchType ?? "CONTAINS");
  const [recipientId, setRecipientId] = useState(target?.recipientId ?? "");
  const [priority, setPriority] = useState(target?.priority ?? 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!target;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    const url = isEdit ? `/api/v1/routing-rules/${target.id}` : "/api/v1/routing-rules";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyKey, matchType, recipientId, priority }),
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

  const activeRecipients = recipients.filter((r) => r.isActive);

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-700 rounded-lg p-5 mb-6 bg-zinc-900/50">
      <h2 className="text-sm font-semibold mb-4">
        {isEdit ? "ルール編集" : "ルール追加"}
      </h2>

      {error && (
        <p className="text-red-400 text-xs mb-3 bg-red-900/20 border border-red-900/50 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">氏名キーワード *</label>
          <input
            type="text"
            className={inputClass}
            value={companyKey}
            onChange={(e) => setCompanyKey(e.target.value)}
            placeholder="例: 鈴木"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">マッチ方式</label>
          <select
            className={inputClass}
            value={matchType}
            onChange={(e) => setMatchType(e.target.value)}
          >
            <option value="EXACT">完全一致</option>
            <option value="CONTAINS">部分一致</option>
            <option value="REGEX">正規表現</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">送信先 *</label>
          <select
            className={inputClass}
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {activeRecipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.displayName}
              </option>
            ))}
          </select>
          {activeRecipients.length === 0 && (
            <p className="text-xs text-zinc-600 mt-1">
              有効な送信先がありません。先に送信先を登録してください。
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">優先度</label>
          <input
            type="number"
            className={inputClass}
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            placeholder="0"
          />
          <p className="text-xs text-zinc-600 mt-1">数値が大きいほど優先</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors disabled:opacity-50"
        >
          {saving ? "保存中..." : isEdit ? "更新" : "追加"}
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
