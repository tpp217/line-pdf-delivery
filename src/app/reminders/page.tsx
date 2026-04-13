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

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function describeCron(cron: string): string {
  const [min, hour, dom, , dow] = cron.split(" ");
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom !== "*" && dow === "*") return `毎月${dom.split(",").join("・")}日 ${time}`;
  if (dow !== "*" && dom === "*") return `毎週${dow.split(",").map((d) => DAY_NAMES[parseInt(d)] || d).join("・")}曜 ${time}`;
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
                  <div className="text-zinc-600">次回: {formatDate(r.nextRunAt)}</div>
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

function parseCron(cron: string): { type: string; days: number[]; hour: number; minute: number } {
  const [min, hour, dom, , dow] = cron.split(" ");
  if (dow !== "*" && dom === "*") return { type: "weekly", days: dow.split(",").map(Number), hour: parseInt(hour), minute: parseInt(min) };
  if (dom !== "*" && dow === "*") return { type: "monthly", days: dom.split(",").map(Number), hour: parseInt(hour), minute: parseInt(min) };
  return { type: "daily", days: [], hour: parseInt(hour), minute: parseInt(min) };
}

function buildCron(type: string, days: number[], hour: number, minute: number): string {
  if (type === "weekly") return `${minute} ${hour} * * ${days.join(",")}`;
  if (type === "monthly") return `${minute} ${hour} ${days.join(",")} * *`;
  return `${minute} ${hour} * * *`;
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
  const parsed = target ? parseCron(target.cronExpression) : { type: "monthly", days: [1], hour: 9, minute: 0 };
  const [title, setTitle] = useState(target?.title ?? "");
  const [message, setMessage] = useState(target?.message ?? "");
  const [recipientId, setRecipientId] = useState(target?.recipientId ?? "");
  const [scheduleType, setScheduleType] = useState(parsed.type);
  const [selectedDays, setSelectedDays] = useState<number[]>(parsed.days);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!target;

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (scheduleType !== "daily" && selectedDays.length === 0) {
      setError(scheduleType === "weekly" ? "曜日を選択してください" : "日を選択してください");
      return;
    }
    setSaving(true);

    const cronExpression = buildCron(scheduleType, selectedDays, hour, minute);
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

  const inputClass = "w-full bg-white border border-zinc-300 rounded px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-500";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-zinc-900 mb-5">{isEdit ? "リマインダー編集" : "新規リマインダー"}</h2>

        {error && <p className="text-red-600 text-xs mb-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs text-zinc-500 mb-1">タイトル</label>
            <input type="text" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 月次報告リマインド" required />
          </div>

          <div className="mb-4">
            <label className="block text-xs text-zinc-500 mb-1">メッセージ</label>
            <textarea className={inputClass + " h-20 resize-none"} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="LINE に送信するテキスト" required />
          </div>

          <div className="mb-4">
            <label className="block text-xs text-zinc-500 mb-1">送信先</label>
            <select className={inputClass} value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
              <option value="">選択</option>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
            </select>
          </div>

          {/* 繰り返しタイプ */}
          <div className="mb-4">
            <label className="block text-xs text-zinc-500 mb-2">繰り返し</label>
            <div className="flex gap-2">
              {[
                { value: "daily", label: "毎日" },
                { value: "weekly", label: "毎週" },
                { value: "monthly", label: "毎月" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setScheduleType(opt.value); setSelectedDays([]); }}
                  className={`px-4 py-1.5 text-sm rounded transition-colors ${
                    scheduleType === opt.value
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 曜日選択 (毎週) */}
          {scheduleType === "weekly" && (
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-2">曜日</label>
              <div className="flex gap-1">
                {DAY_NAMES.map((name, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-10 h-10 rounded text-sm transition-colors ${
                      selectedDays.includes(i)
                        ? "bg-zinc-900 text-white"
                        : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 日選択 (毎月) */}
          {scheduleType === "monthly" && (
            <div className="mb-4">
              <label className="block text-xs text-zinc-500 mb-2">日</label>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`h-9 rounded text-xs transition-colors ${
                      selectedDays.includes(d)
                        ? "bg-zinc-900 text-white"
                        : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 時刻 */}
          <div className="mb-6">
            <label className="block text-xs text-zinc-500 mb-2">時刻</label>
            <div className="flex gap-2 items-center">
              <select
                className={inputClass + " !w-20"}
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                ))}
              </select>
              <span className="text-zinc-500">:</span>
              <select
                className={inputClass + " !w-20"}
                value={minute}
                onChange={(e) => setMinute(parseInt(e.target.value))}
              >
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-zinc-900 text-white text-sm font-medium rounded hover:bg-zinc-800 transition-colors disabled:opacity-50">
              {saving ? "保存中..." : isEdit ? "更新" : "作成"}
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">キャンセル</button>
          </div>
        </form>
      </div>
    </div>
  );
}
