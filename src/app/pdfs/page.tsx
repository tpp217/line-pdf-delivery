"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

type PdfDocument = {
  id: string;
  originalFileName: string;
  fileSizeBytes: number;
  pageCount: number | null;
  extractStatus: string;
  companyName: string | null;
  personName: string | null;
  companyNameManual: string | null;
  personNameManual: string | null;
  uploadedAt: string;
};

type PdfListResponse = {
  items: PdfDocument[];
  total: number;
  page: number;
  pageSize: number;
};

export default function PdfsPage() {
  const [data, setData] = useState<PdfListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchPdfs = useCallback(async (page = 1) => {
    setLoading(true);
    const res = await fetch(`/api/v1/pdfs?page=${page}&pageSize=20`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPdfs();
  }, [fetchPdfs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append("files", file);
    }
    formData.append("sourceFolderName", "ブラウザアップロード");

    const res = await fetch("/api/v1/uploads/folder", {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
      const result = await res.json();
      alert(
        `${result.acceptedFiles}件のPDFをアップロードしました${result.ignoredFiles > 0 ? ` (${result.ignoredFiles}件のPDF以外のファイルをスキップ)` : ""}`,
      );
      fetchPdfs();
    } else {
      const err = await res.json();
      alert(`エラー: ${err.error}`);
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExtract = async (id: string) => {
    setExtractingId(id);
    const res = await fetch(`/api/v1/pdfs/${id}/extract`, { method: "POST" });
    if (res.ok) {
      fetchPdfs();
    } else {
      const err = await res.json();
      alert(`抽出エラー: ${err.error}`);
    }
    setExtractingId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await fetch(`/api/v1/pdfs/${id}`, { method: "DELETE" });
    fetchPdfs();
  };

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      PENDING: { label: "未抽出", cls: "bg-zinc-800 text-zinc-400" },
      PROCESSING: { label: "処理中", cls: "bg-yellow-900/50 text-yellow-400" },
      DONE: { label: "完了", cls: "bg-emerald-900/50 text-emerald-400" },
      FAILED: { label: "失敗", cls: "bg-red-900/50 text-red-400" },
    };
    const m = map[s] || { label: s, cls: "bg-zinc-800 text-zinc-400" };
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
    );
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <main className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">
            ← ホーム
          </Link>
          <h1 className="text-xl font-bold mt-1">PDF管理</h1>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleUpload}
            className="hidden"
            id="pdf-upload"
          />
          <label
            htmlFor="pdf-upload"
            className={`px-4 py-2 text-sm font-medium rounded cursor-pointer transition-colors ${
              uploading
                ? "bg-zinc-700 text-zinc-400 cursor-wait"
                : "bg-zinc-100 text-zinc-900 hover:bg-white"
            }`}
          >
            {uploading ? "アップロード中..." : "+ PDFアップロード"}
          </label>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中...</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          PDFがありません。「PDFアップロード」から追加してください。
        </p>
      ) : (
        <>
          <div className="text-xs text-zinc-500 mb-3">
            全 {data.total} 件
          </div>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  <th className="text-left p-3">ファイル名</th>
                  <th className="text-right p-3">サイズ</th>
                  <th className="text-center p-3">抽出状態</th>
                  <th className="text-left p-3">会社名</th>
                  <th className="text-left p-3">氏名</th>
                  <th className="text-right p-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.items.map((pdf) => (
                  <tr key={pdf.id} className="hover:bg-zinc-900/50">
                    <td className="p-3 font-mono text-xs max-w-60 truncate">
                      {pdf.originalFileName}
                    </td>
                    <td className="p-3 text-right text-xs text-zinc-500">
                      {formatSize(pdf.fileSizeBytes)}
                      {pdf.pageCount && (
                        <span className="ml-1">({pdf.pageCount}p)</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {statusLabel(pdf.extractStatus)}
                    </td>
                    <td className="p-3 text-xs">
                      {pdf.companyNameManual || pdf.companyName || (
                        <span className="text-zinc-600">-</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {pdf.personNameManual || pdf.personName || (
                        <span className="text-zinc-600">-</span>
                      )}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      {(pdf.extractStatus === "PENDING" ||
                        pdf.extractStatus === "FAILED") && (
                        <button
                          onClick={() => handleExtract(pdf.id)}
                          disabled={extractingId === pdf.id}
                          className="text-xs text-zinc-400 hover:text-zinc-100 disabled:text-zinc-600"
                        >
                          {extractingId === pdf.id ? "抽出中..." : "抽出"}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          handleDelete(pdf.id, pdf.originalFileName)
                        }
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
        </>
      )}
    </main>
  );
}
