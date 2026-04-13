"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Recipient = { id: string; displayName: string; isActive: boolean };

type Reminder = {
  id: string;
  title: string;
  message: string;
  recipientId: string;
  recipient: Recipient | null;
  cronExpression: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  isActive: boolean;
};

const PRESETS = [
  { label: "毎月1日 9:00", cron: "0 9 1 * *" },
  { label: "毎月1日・15日 9:00", cron: "0 9 1,15 * *" },
  { label: "毎週月曜 9:00", cron: "0 9 * * 1" },
  { label: "毎日 9:00", cron: "0 9 * * *" },
];

function describeCron(cron: string): string {
  const [min, hour, dom, , dow] = cron.split(" ");
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  if (dom !== "*" && dow === "*") return `毎月${dom.split(",").join("・")}日 ${time}`;
  if (dow !== "*" && dom === "*") return `毎週${dow.split(",").map((d) => dayNames[parseInt(d)] || d).join("・")}曜 ${time}`;
  if (dom === "*" && dow === "*") return `毎日 ${time}`;
  return cron;
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Reminder | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [rRes, rcRes] = await Promise.all([
      fetch("/api/v1/reminders"),
      fetch("/api/v1/recipients?isActive=true"),
    ]);
    setReminders(await rRes.json());
    setRecipients(await rcRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (r: Reminder) => {
    await fetch(`/api/v1/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !r.isActive }),
    });
    fetchData();
  };

  const handleDelete = async (r: Reminder) => {
    if (!confirm(`「${r.title}」を削除しますか？`)) return;
    await fetch(`/api/v1/reminders/${r.id}`, { method: "DELETE" });
    fetchData();
  };

  return (
    <main className="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">← ホーム</Link>
          <h1 className="text-xl font-bold mt-1">リマインダー</h1>
          <p className="text-zinc-500 text-xs mt-1">指定日時にテキストを自動LINE送信</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors"
        >
          + 新規作成
        </button>
      </div>

      {showForm && (
        <ReminderForm
          target={editTarget}
          recipients={recipients}
          onDone={() => { setShowForm(false); setEditTarget(null); fetchData(); }}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {loading ? <p className="text-zinc-500 text-sm">読み込み中...</p> : reminders.length === 0 ? (
        <p className="text-zinc-500 text-sm">リマインダーがありません。</p>
      ) : (
        <div className="space-y-3">
          {reminders.map((r) => (
            <div key={r.id} className={`border rounded-lg p-4 ${r.isActive ? "border-zinc-700" : "border-zinc-800 opacity-50"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm">{r.title}</div>
                  <div className="text-xs text-zinc-400 mt-1">{describeCron(r.cronExpression)}</div>
                  <div className="text-xs text-zinc-500 mt-1">→ {r.recipient?.displayName || "不明"}</div>
                  <div className="text-xs text-zinc-600 mt-2 bg-zinc-900 rounded px-2 py-1 inline-block max-w-md truncate">
                    {r.message}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-xs">
                  <button
                    onClick={() => handleToggle(r)}
                    className={`px-2 py-0.5 rounded ${r.isActive ? "bg-emerald-900/50 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}
                  >
                    {r.isActive ? "有効" : "無効"}
                  </button>
                  <div className="text-zinc-600">
                    次回: {formatDate(r.nextRunAt)}
                  </div>
                  {r.lastRunAt && <div className="text-zinc-700">前回: {formatDate(r.lastRunAt)}</div>}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => { setEditTarget(r); setShowForm(true); }} className="text-xs text-zinc-400 hover:text-zinc-100">編集</button>
                <button onClick={() => handleDelete(r)} className="text-xs text-zinc-500 hover:text-red-400">削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ReminderForm({
  target,
  recipients,
  onDone,
  onCancel,
}: {
  target: Reminder | null;
  recipients: Recipient[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(target?.title ?? "");
  const [message, setMessage] = useState(target?.message ?? "");
  const [recipientId, setRecipientId] = useState(target?.recipientId ?? "");
  const [cronExpression, setCronExpression] = useState(target?.cronExpression ?? "0 9 1 * *");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!target;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    const url = isEdit ? `/api/v1/reminders/${target.id}` : "/api/v1/reminders";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message, recipientId, cronExpression }),
    });

    if (!res.ok) {
      setError((await res.json()).error || "保存失敗");
      setSaving(false);
      return;
    }
    onDone();
  };

  const inputClass = "w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500";

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-700 rounded-lg p-5 mb-6 bg-zinc-900/50">
      <h2 className="text-sm font-semibold mb-4">{isEdit ? "リマインダー編集" : "新規リマインダー"}</h2>

      {error && <p className="text-red-400 text-xs mb-3 bg-red-900/20 border border-red-900/50 rounded px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">タイトル *</label>
          <input type="text" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 月次報告リマインド" required />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">送信先 *</label>
          <select className={inputClass} value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
            <option value="">選択</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-zinc-400 mb-1">メッセージ *</label>
        <textarea className={inputClass + " h-24 resize-none"} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="LINE に送信するテキスト" required />
      </div>

      <div className="mb-4">
        <label className="block text-xs text-zinc-400 mb-1">繰り返し</label>
        <div className="flex gap-2 mb-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => setCronExpression(p.cron)}
              className={`px-3 py-1 text-xs rounded transition-colors ${cronExpression === p.cron ? "bg-zinc-100 text-zinc-900" : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input type="text" className={inputClass} value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="0 9 1 * *" />
        <p className="text-xs text-zinc-600 mt-1">cron 形式: 分 時 日 月 曜日 → {describeCron(cronExpression)}</p>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors disabled:opacity-50">
          {saving ? "保存中..." : isEdit ? "更新" : "作成"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">キャンセル</button>
      </div>
    </form>
  );
}
