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
  if (dom !== "*" && dow === "*") return `毎月${dom.split(",").join("・")}日 15:00`;
  if (dow !== "*" && dom === "*") return `毎週${dow.split(",").map((d) => DAY_NAMES[parseInt(d)] || d).join("・")}曜 15:00`;
  if (dom === "*" && dow === "*") return `毎日 15:00`;
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
      fetch("/lpd/api/v1/reminders"),
      fetch("/lpd/api/v1/recipients?isActive=true"),
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
    <div style={{ padding: "1.5rem" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#e2e8f0", margin: 0, letterSpacing: "0.05em" }}>リマインダー</h1>
            <p style={{ color: "#718096", fontSize: "0.75rem", marginTop: "0.3rem" }}>指定日時にテキストを自動LINE送信</p>
          </div>
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            style={{ background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "0.35rem 1rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}
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
          <p style={{ color: "#718096", fontSize: "0.8rem" }}>読み込み中...</p>
        ) : reminders.length === 0 ? (
          <p style={{ color: "#718096", fontSize: "0.8rem" }}>リマインダーがありません。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {reminders.map((r) => (
              <div key={r.id} style={{
                border: `1px solid ${r.isActive ? "rgba(0,255,255,0.25)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: "6px",
                padding: "1rem",
                background: "#0d1117",
                opacity: r.isActive ? 1 : 0.55,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#e2e8f0" }}>{r.title}</div>
                    <div style={{ fontSize: "0.75rem", color: "#00ffff", marginTop: "0.3rem" }}>{describeCron(r.cronExpression)}</div>
                    <div style={{ fontSize: "0.75rem", color: "#718096", marginTop: "0.2rem" }}>→ {r.recipient?.displayName || "不明"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#718096", marginTop: "0.5rem", background: "#111827", borderRadius: "4px", padding: "0.25rem 0.5rem", display: "inline-block", maxWidth: "28rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.message}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem", fontSize: "0.75rem" }}>
                    <button
                      onClick={() => handleToggle(r)}
                      style={{
                        border: `1px solid ${r.isActive ? "#00ff41" : "#718096"}`,
                        color: r.isActive ? "#00ff41" : "#718096",
                        background: r.isActive ? "rgba(0,255,65,0.06)" : "transparent",
                        fontSize: "0.7rem", padding: "0.1rem 0.5rem", borderRadius: "3px", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {r.isActive ? "有効" : "無効"}
                    </button>
                    <div style={{ color: "#718096" }}>次回: {formatDate(r.nextRunAt)}</div>
                    {r.lastRunAt && <div style={{ color: "#4a5568" }}>前回: {formatDate(r.lastRunAt)}</div>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", borderTop: "1px solid rgba(0,255,255,0.07)", paddingTop: "0.5rem" }}>
                  <button onClick={() => { setEditTarget(r); setShowForm(true); }} style={{ background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", padding: "0.1rem 0.3rem" }}>編集</button>
                  <button onClick={() => handleDelete(r)} style={{ background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", padding: "0.1rem 0.3rem" }}>削除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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

  const scheduleOpts = [
    { value: "daily", label: "毎日" },
    { value: "weekly", label: "毎週" },
    { value: "monthly", label: "毎月" },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onCancel}
    >
      <div
        style={{ background: "#0d1117", border: "1px solid #00ffff", boxShadow: "0 0 12px rgba(0,255,255,0.4)", borderRadius: "6px", padding: "1.5rem", width: "28rem", maxHeight: "90vh", overflowY: "auto", fontFamily: "'JetBrains Mono','Courier New',monospace" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ color: "#00ffff", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.25rem", borderBottom: "1px solid rgba(0,255,255,0.2)", paddingBottom: "0.5rem" }}>
          {isEdit ? "リマインダー編集" : "新規リマインダー"}
        </h2>

        {error && (
          <p style={{ color: "#f87171", fontSize: "0.75rem", marginBottom: "0.75rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px", padding: "0.4rem 0.75rem" }}>
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>タイトル</label>
            <input type="text" style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 月次報告リマインド" required />
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>メッセージ</label>
            <textarea style={{ ...inputStyle, height: "5rem", resize: "none" }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="LINEに送信するテキスト" required />
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>送信先</label>
            <select style={inputStyle} value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
              <option value="">選択</option>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.5rem" }}>繰り返し</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {scheduleOpts.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setScheduleType(opt.value); setSelectedDays([]); }}
                  style={{
                    padding: "0.3rem 0.75rem",
                    fontSize: "0.75rem",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    border: `1px solid ${scheduleType === opt.value ? "#00ffff" : "rgba(0,255,255,0.2)"}`,
                    background: scheduleType === opt.value ? "#00ffff" : "transparent",
                    color: scheduleType === opt.value ? "#0a0a0f" : "#a0aec0",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {scheduleType === "weekly" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.5rem" }}>曜日</label>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {DAY_NAMES.map((name, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    style={{
                      width: "2.2rem", height: "2.2rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      border: `1px solid ${selectedDays.includes(i) ? "#00ffff" : "rgba(0,255,255,0.2)"}`,
                      background: selectedDays.includes(i) ? "#00ffff" : "transparent",
                      color: selectedDays.includes(i) ? "#0a0a0f" : "#a0aec0",
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {scheduleType === "monthly" && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.5rem" }}>日</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.3rem" }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    style={{
                      height: "2rem",
                      borderRadius: "3px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      border: `1px solid ${selectedDays.includes(d) ? "#00ffff" : "rgba(0,255,255,0.15)"}`,
                      background: selectedDays.includes(d) ? "#00ffff" : "transparent",
                      color: selectedDays.includes(d) ? "#0a0a0f" : "#a0aec0",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#718096", marginBottom: "0.3rem" }}>送信時刻</label>
            <p style={{ fontSize: "0.8rem", color: "#e2e8f0" }}>15:00 (固定)</p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              type="submit"
              disabled={saving}
              style={{ background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "0.4rem 1.25rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", opacity: saving ? 0.5 : 1 }}
            >
              {saving ? "保存中..." : isEdit ? "更新" : "作成"}
            </button>
            <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "#718096", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
