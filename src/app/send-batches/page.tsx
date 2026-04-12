"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type SendBatch = {
  id: string;
  title: string;
  status: string;
  totalJobs: number;
  successJobs: number;
  failedJobs: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type PdfDocument = {
  id: string;
  originalFileName: string;
  personName: string | null;
  uploadedAt: string;
};

type SendJob = {
  id: string;
  pdfDocument: { id: string; originalFileName: string; personName: string | null } | null;
  recipient: { id: string; displayName: string } | null;
  status: string;
};

type BatchDetail = SendBatch & { jobs: SendJob[] };

export default function SendBatchesPage() {
  const [batches, setBatches] = useState<SendBatch[]>([]);
  const [pdfs, setPdfs] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedPdfs, setSelectedPdfs] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<BatchDetail | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [bRes, pRes] = await Promise.all([
      fetch("/api/v1/send-batches"),
      fetch("/api/v1/pdfs?page=1&pageSize=1000"),
    ]);
    setBatches(await bRes.json());
    const pData = await pRes.json();
    setPdfs(pData.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAutoCreate = async () => {
    if (selectedPdfs.size === 0) {
      alert("PDFを選択してください");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/v1/send-batches/auto-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `送信 ${new Date().toLocaleDateString("ja-JP")}`,
        pdfIds: Array.from(selectedPdfs),
      }),
    });

    const result = await res.json();
    if (res.ok) {
      const msg = `バッチ作成: ${result.matched}件マッチ` +
        (result.unmatched.length > 0
          ? `\n未マッチ: ${result.unmatched.join(", ")}`
          : "");
      alert(msg);
      setShowCreate(false);
      setSelectedPdfs(new Set());
      fetchData();
    } else {
      alert(`エラー: ${result.error}${result.unmatched ? "\n未マッチ: " + result.unmatched.join(", ") : ""}`);
    }
    setCreating(false);
  };

  const loadDetail = async (id: string) => {
    const res = await fetch(`/api/v1/send-batches/${id}`);
    setDetail(await res.json());
  };

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      DRAFT: { label: "下書き", cls: "bg-zinc-800 text-zinc-400" },
      QUEUED: { label: "キュー待ち", cls: "bg-yellow-900/50 text-yellow-400" },
      PROCESSING: { label: "送信中", cls: "bg-blue-900/50 text-blue-400" },
      COMPLETED: { label: "完了", cls: "bg-emerald-900/50 text-emerald-400" },
      PARTIAL: { label: "一部失敗", cls: "bg-orange-900/50 text-orange-400" },
      FAILED: { label: "失敗", cls: "bg-red-900/50 text-red-400" },
      PENDING: { label: "待機", cls: "bg-zinc-800 text-zinc-400" },
      SENT: { label: "送信済", cls: "bg-emerald-900/50 text-emerald-400" },
    };
    const m = map[s] || { label: s, cls: "bg-zinc-800 text-zinc-400" };
    return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
  };

  const togglePdf = (id: string) => {
    setSelectedPdfs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (detail) {
    return (
      <main className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full">
        <button onClick={() => setDetail(null)} className="text-zinc-500 text-xs hover:text-zinc-300 mb-4">
          ← バッチ一覧に戻る
        </button>
        <h1 className="text-xl font-bold mb-1">{detail.title}</h1>
        <div className="flex gap-3 mb-6 text-xs text-zinc-400">
          {statusLabel(detail.status)}
          <span>全{detail.totalJobs}件</span>
          {detail.successJobs > 0 && <span className="text-emerald-400">成功{detail.successJobs}</span>}
          {detail.failedJobs > 0 && <span className="text-red-400">失敗{detail.failedJobs}</span>}
        </div>
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                <th className="text-left p-3">PDF</th>
                <th className="text-left p-3">氏名</th>
                <th className="text-left p-3">送信先</th>
                <th className="text-center p-3">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {detail.jobs.map((job) => (
                <tr key={job.id} className="hover:bg-zinc-900/50">
                  <td className="p-3 text-xs">{job.pdfDocument?.originalFileName || "-"}</td>
                  <td className="p-3 text-xs">{job.pdfDocument?.personName || "-"}</td>
                  <td className="p-3 text-xs">{job.recipient?.displayName || "-"}</td>
                  <td className="p-3 text-center">{statusLabel(job.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">← ホーム</Link>
          <h1 className="text-xl font-bold mt-1">送信バッチ</h1>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors"
        >
          + 新規バッチ作成
        </button>
      </div>

      {showCreate && (
        <div className="border border-zinc-700 rounded-lg p-5 mb-6 bg-zinc-900/50">
          <h2 className="text-sm font-semibold mb-3">PDF を選択 → ルールで自動マッチ</h2>
          <p className="text-xs text-zinc-500 mb-4">
            選択したPDFの氏名とルーティングルールを照合し、送信先を自動決定します。
          </p>

          <div className="max-h-60 overflow-y-auto border border-zinc-800 rounded mb-4">
            {pdfs.map((pdf) => (
              <label key={pdf.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={selectedPdfs.has(pdf.id)}
                  onChange={() => togglePdf(pdf.id)}
                  className="rounded border-zinc-600"
                />
                <span>{pdf.originalFileName}</span>
                <span className="text-zinc-500 ml-auto">{pdf.personName || "-"}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-3 items-center">
            <button
              onClick={() => setSelectedPdfs(new Set(pdfs.map((p) => p.id)))}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              全選択
            </button>
            <button
              onClick={() => setSelectedPdfs(new Set())}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              全解除
            </button>
            <div className="flex-1" />
            <span className="text-xs text-zinc-500">{selectedPdfs.size}件選択</span>
            <button
              onClick={handleAutoCreate}
              disabled={creating || selectedPdfs.size === 0}
              className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors disabled:opacity-50"
            >
              {creating ? "作成中..." : "バッチ作成"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中...</p>
      ) : batches.length === 0 ? (
        <p className="text-zinc-500 text-sm">バッチがありません。</p>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                <th className="text-left p-3">タイトル</th>
                <th className="text-center p-3">状態</th>
                <th className="text-right p-3">件数</th>
                <th className="text-right p-3">作成日</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-900/50">
                  <td className="p-3">{b.title}</td>
                  <td className="p-3 text-center">{statusLabel(b.status)}</td>
                  <td className="p-3 text-right text-xs text-zinc-400">{b.totalJobs}件</td>
                  <td className="p-3 text-right text-xs text-zinc-500">
                    {new Date(b.createdAt).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => loadDetail(b.id)}
                      className="text-xs text-zinc-400 hover:text-zinc-100"
                    >
                      詳細
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
