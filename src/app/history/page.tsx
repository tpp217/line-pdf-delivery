"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HistoryItem = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";
  kind: "PDF" | "TEXT";
  recipient: { id: string; displayName: string } | null;
  pdfFileName: string | null;
  messageTitle: string | null;
  messageBody: string | null;
  errorMessage: string | null;
};

type Recipient = { id: string; displayName: string };

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "SENT", label: "成功" },
  { value: "FAILED", label: "失敗" },
];

const RANGE_FILTERS: { value: string; label: string; days: number | null }[] = [
  { value: "7d", label: "過去7日", days: 7 },
  { value: "30d", label: "過去30日", days: 30 },
  { value: "all", label: "全期間", days: null },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadge(status: HistoryItem["status"]) {
  switch (status) {
    case "SENT":
      return <span className="badge badge--green"><span className="dot dot--green" />送信済</span>;
    case "FAILED":
      return <span className="badge badge--red"><span className="dot dot--red" />失敗</span>;
    case "PENDING":
    case "PROCESSING":
      return <span className="badge badge--amber"><span className="dot dot--amber" />処理中</span>;
    case "CANCELLED":
      return <span className="badge badge--gray">中止</span>;
    default:
      return <span className="badge badge--gray">{status}</span>;
  }
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRecipient, setFilterRecipient] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterRange, setFilterRange] = useState<string>("30d");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buildQuery = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set("limit", "200");
    if (filterRecipient) sp.set("recipientId", filterRecipient);
    if (filterStatus) sp.set("status", filterStatus);
    const range = RANGE_FILTERS.find((r) => r.value === filterRange);
    if (range?.days != null) {
      const from = new Date(Date.now() - range.days * 24 * 60 * 60 * 1000).toISOString();
      sp.set("from", from);
    }
    return sp.toString();
  }, [filterRecipient, filterStatus, filterRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [hRes, rRes] = await Promise.all([
      fetch(`/api/v1/history?${buildQuery()}`),
      recipients.length === 0 ? fetch("/api/v1/recipients") : Promise.resolve(null),
    ]);
    const hData = await hRes.json();
    setItems(hData.items ?? []);
    setTotal(hData.total ?? 0);
    if (rRes) {
      const rData = await rRes.json();
      setRecipients(rData);
    }
    setLoading(false);
  }, [buildQuery, recipients.length]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    const sent = items.filter((i) => i.status === "SENT").length;
    const failed = items.filter((i) => i.status === "FAILED").length;
    return { sent, failed };
  }, [items]);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">送信履歴</h1>
          <p className="page__sub">
            <span className="num">{total}</span> 件 ・ 成功 <span className="num text-green">{summary.sent}</span> ・ 失敗 <span className="num text-red">{summary.failed}</span>
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card__body" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 200 }}>
            <label className="field__label">宛先</label>
            <select
              className="select"
              value={filterRecipient}
              onChange={(e) => setFilterRecipient(e.target.value)}
            >
              <option value="">すべて</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.displayName}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="field__label">ステータス</label>
            <select
              className="select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field__label">期間</label>
            <div className="toolbar">
              {RANGE_FILTERS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`chip ${filterRange === r.value ? "is-active" : ""}`}
                  onClick={() => setFilterRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 140 }}>日時</th>
                <th style={{ width: 70 }}>種別</th>
                <th style={{ width: 180 }}>宛先</th>
                <th>内容</th>
                <th style={{ width: 110 }}>ステータス</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="empty">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="empty">条件に一致する履歴がありません</td></tr>
              )}
              {!loading && items.map((it) => {
                const isOpen = expanded.has(it.id);
                const content = it.kind === "PDF"
                  ? (it.pdfFileName ?? "(PDFが削除されました)")
                  : (it.messageBody ?? "");
                return (
                  <>
                    <tr key={it.id} onClick={() => toggleExpand(it.id)} style={{ cursor: "pointer" }}>
                      <td className="num td-muted">{formatDateTime(it.createdAt)}</td>
                      <td>
                        <span className={`badge ${it.kind === "PDF" ? "badge--blue" : "badge--purple"}`}>
                          {it.kind}
                        </span>
                      </td>
                      <td>{it.recipient?.displayName ?? <span className="text-mute">(削除済)</span>}</td>
                      <td className="truncate" style={{ maxWidth: 400 }}>{content}</td>
                      <td>{statusBadge(it.status)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${it.id}-d`}>
                        <td colSpan={5} style={{ background: "var(--surface-2)", padding: "12px 16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 16px", fontSize: 12 }}>
                            <div className="text-mute">送信日時</div>
                            <div className="num">{it.sentAt ? formatDateTime(it.sentAt) : "—"}</div>
                            {it.messageBody && (
                              <>
                                <div className="text-mute">本文</div>
                                <div style={{ whiteSpace: "pre-wrap" }}>{it.messageBody}</div>
                              </>
                            )}
                            {it.errorMessage && (
                              <>
                                <div className="text-mute">エラー</div>
                                <div className="text-red" style={{ whiteSpace: "pre-wrap" }}>{it.errorMessage}</div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
