"use client";

import { useEffect, useState, useCallback } from "react";

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
  const [, , dom, , dow] = cron.split(" ");
  if (dom !== "*" && dow === "*") return `毎月 ${dom.split(",").join("・")}日 15:00`;
  if (dow !== "*" && dom === "*") return `毎週 ${dow.split(",").map((d) => DAY_NAMES[parseInt(d)] || d).join("・")}曜 15:00`;
  if (dom === "*" && dow === "*") return `毎日 15:00`;
  return cron;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
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
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">リマインダー</h1>
          <p className="page__sub">指定スケジュールでテキストを自動LINE送信します。</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="btn btn--primary"
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

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : reminders.length === 0 ? (
        <div className="empty">リマインダーがありません。右上の「新規作成」から追加してください。</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {reminders.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{ opacity: r.isActive ? 1 : 0.62 }}
            >
              <div style={{ padding: 14, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{r.title}</span>
                    {r.isActive ? (
                      <span className="badge badge--green"><span className="dot dot--green" />有効</span>
                    ) : (
                      <span className="badge badge--gray">無効</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--blue-2)", marginBottom: 2 }} className="num">{describeCron(r.cronExpression)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                    → {r.recipient?.displayName || "不明"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-2)",
                      background: "var(--surface-2)",
                      borderRadius: 4,
                      padding: "6px 10px",
                      maxWidth: 520,
                    }}
                    className="truncate"
                  >
                    {r.message}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontSize: 11.5, color: "var(--text-3)", flexShrink: 0 }}>
                  <label className="toggle">
                    <input type="checkbox" checked={r.isActive} onChange={() => handleToggle(r)} />
                    <span className="toggle__track"><span className="toggle__thumb" /></span>
                  </label>
                  <div>次回: <span className="num" style={{ color: "var(--text-2)" }}>{formatDate(r.nextRunAt)}</span></div>
                  {r.lastRunAt && <div>前回: <span className="num">{formatDate(r.lastRunAt)}</span></div>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, padding: "8px 10px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
                <button onClick={() => { setEditTarget(r); setShowForm(true); }} className="btn btn--ghost btn--sm">編集</button>
                <button onClick={() => handleDelete(r)} className="btn btn--danger btn--sm">削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const parsed = target ? parseCron(target.cronExpression) : { type: "monthly", days: [1], hour: 15, minute: 0 };
  const [title, setTitle] = useState(target?.title ?? "");
  const [message, setMessage] = useState(target?.message ?? "");
  const [recipientId, setRecipientId] = useState(target?.recipientId ?? "");
  const [scheduleType, setScheduleType] = useState(parsed.type);
  const [selectedDays, setSelectedDays] = useState<number[]>(parsed.days);
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

    const cronExpression = buildCron(scheduleType, selectedDays, 15, 0);
    const url = isEdit ? `/api/v1/reminders/${target.id}` : "/api/v1/reminders";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message, recipientId, cronExpression }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "保存失敗");
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(`通信エラー: ${err instanceof Error ? err.message : "不明"}`);
      setSaving(false);
    }
  };

  const scheduleOpts = [
    { value: "daily", label: "毎日" },
    { value: "weekly", label: "毎週" },
    { value: "monthly", label: "毎月" },
  ];

  return (
    <div className="modal__backdrop" onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="modal modal--wide"
      >
        <div className="modal__head">
          <div className="modal__title">{isEdit ? "リマインダー編集" : "新規リマインダー"}</div>
        </div>
        <div className="modal__body">
          {error && <div className="alert alert--red">{error}</div>}

          <div className="field">
            <label className="field__label">タイトル</label>
            <input type="text" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 月次報告リマインド" required />
          </div>

          <div className="field">
            <label className="field__label">メッセージ</label>
            <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="LINEに送信するテキスト" required />
          </div>

          <div className="field">
            <label className="field__label">送信先</label>
            <select className="select" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
              <option value="">選択してください</option>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field__label">繰り返し</label>
            <div style={{ display: "flex", gap: 6 }}>
              {scheduleOpts.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setScheduleType(opt.value); setSelectedDays([]); }}
                  className={`chip ${scheduleType === opt.value ? "is-active" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {scheduleType === "weekly" && (
            <div className="field">
              <label className="field__label">曜日</label>
              <div style={{ display: "flex", gap: 6 }}>
                {DAY_NAMES.map((name, i) => {
                  const isSel = selectedDays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 5,
                        fontSize: 12.5,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontWeight: 500,
                        border: `1px solid ${isSel ? "var(--blue)" : "var(--border)"}`,
                        background: isSel ? "var(--blue)" : "var(--surface)",
                        color: isSel ? "#fff" : "var(--text-2)",
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {scheduleType === "monthly" && (
            <div className="field">
              <label className="field__label">日</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                  const isSel = selectedDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      style={{
                        height: 30,
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                        fontVariantNumeric: "tabular-nums",
                        border: `1px solid ${isSel ? "var(--blue)" : "var(--border)"}`,
                        background: isSel ? "var(--blue)" : "var(--surface)",
                        color: isSel ? "#fff" : "var(--text-2)",
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="field">
            <label className="field__label">送信時刻</label>
            <p style={{ fontSize: 13, color: "var(--text)", margin: 0 }}>
              <span className="num">15:00</span> <span className="text-mute">(固定)</span>
            </p>
          </div>
        </div>

        <div className="modal__foot">
          <button type="button" onClick={onCancel} className="btn">キャンセル</button>
          <button type="submit" disabled={saving} className="btn btn--primary">
            {saving ? "保存中…" : isEdit ? "更新する" : "作成する"}
          </button>
        </div>
      </form>
    </div>
  );
}
