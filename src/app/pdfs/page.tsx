"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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

async function readAllEntries(
  entry: FileSystemEntry,
  result: File[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve),
    );
    result.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[] = [];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve),
      );
      for (const child of batch) await readAllEntries(child, result);
    } while (batch.length > 0);
  }
}

function toYm(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function PdfsPage() {
  const [allPdfs, setAllPdfs] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchPdfs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/v1/pdfs?page=1&pageSize=1000");
    const json = await res.json();
    setAllPdfs(json.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPdfs();
  }, [fetchPdfs]);

  const years = useMemo(() => {
    const s = new Set<string>();
    allPdfs.forEach((p) => s.add(new Date(p.uploadedAt).getFullYear().toString()));
    return Array.from(s).sort().reverse();
  }, [allPdfs]);

  const yearPdfs = useMemo(() => {
    if (selectedYear === "all") return allPdfs;
    return allPdfs.filter((p) => new Date(p.uploadedAt).getFullYear().toString() === selectedYear);
  }, [allPdfs, selectedYear]);

  const months = useMemo(() => {
    const s = new Set<string>();
    yearPdfs.forEach((p) => s.add(String(new Date(p.uploadedAt).getMonth() + 1).padStart(2, "0")));
    return Array.from(s).sort().reverse();
  }, [yearPdfs]);

  const filteredPdfs = useMemo(() => {
    if (selectedMonth === "all") return yearPdfs;
    return yearPdfs.filter((p) => String(new Date(p.uploadedAt).getMonth() + 1).padStart(2, "0") === selectedMonth);
  }, [yearPdfs, selectedMonth]);

  useEffect(() => {
    setSelectedMonth("all");
  }, [selectedYear]);

  useEffect(() => {
    setSelected(new Set());
  }, [selectedYear, selectedMonth]);

  const uploadFiles = useCallback(
    async (files: File[], folderName?: string) => {
      if (files.length === 0) return;
      setUploading(true);
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      formData.append("sourceFolderName", folderName || "ブラウザアップロード");

      try {
        const res = await fetch("/api/v1/uploads/folder", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const result = await res.json();
          alert(
            `${result.acceptedFiles}件のPDFを登録しました` +
              (result.ignoredFiles > 0
                ? ` (${result.ignoredFiles}件スキップ)`
                : ""),
          );
          fetchPdfs();
        } else {
          const err = await res.json();
          alert(`エラー: ${err.error}`);
        }
      } catch (e) {
        alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
      }
      setUploading(false);
    },
    [fetchPdfs],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;
    const allFiles: File[] = [];
    const entries = Array.from(items)
      .map((i) => i.webkitGetAsEntry?.())
      .filter(Boolean) as FileSystemEntry[];
    for (const entry of entries) await readAllEntries(entry, allFiles);
    if (allFiles.length === 0) {
      const fallback = Array.from(e.dataTransfer.files);
      if (fallback.length > 0) { uploadFiles(fallback); return; }
      alert("対応するファイルが見つかりませんでした");
      return;
    }
    const folderEntry = entries.find((e) => e.isDirectory);
    uploadFiles(allFiles, folderEntry?.name);
  };

  const handleDeleteSingle = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await fetch(`/api/v1/pdfs/${id}`, { method: "DELETE" });
    fetchPdfs();
  };

  const handleBulkDelete = async (ids: string[], label: string) => {
    if (!confirm(`${label} (${ids.length}件) を削除しますか？`)) return;
    setDeleting(true);
    await fetch("/api/v1/pdfs/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    await fetchPdfs();
    setDeleting(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredPdfs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredPdfs.map((p) => p.id)));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      PENDING: { label: "未抽出", cls: "bg-zinc-800 text-zinc-400" },
      PROCESSING: { label: "処理中", cls: "bg-yellow-900/50 text-yellow-400" },
      DONE: { label: "完了", cls: "bg-emerald-900/50 text-emerald-400" },
      FAILED: { label: "失敗", cls: "bg-red-900/50 text-red-400" },
    };
    const m = map[s] || { label: s, cls: "bg-zinc-800 text-zinc-400" };
    return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
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
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 mb-6 text-center transition-colors ${
          dragging ? "border-zinc-400 bg-zinc-900" : "border-zinc-700 hover:border-zinc-600"
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple onChange={handleFileInput} className="hidden" id="pdf-upload" />
        <label htmlFor="pdf-upload" className={`inline-block px-5 py-2 text-sm font-medium rounded cursor-pointer transition-colors ${uploading ? "bg-zinc-700 text-zinc-400 cursor-wait" : "bg-zinc-100 text-zinc-900 hover:bg-white"}`}>
          {uploading ? "アップロード中..." : "ファイルを選択"}
        </label>
        <p className="text-zinc-500 text-xs mt-2">PDF・ZIP選択、またはフォルダをD&D（ZIP内フォルダも自動展開）</p>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中...</p>
      ) : allPdfs.length === 0 ? (
        <p className="text-zinc-500 text-sm">PDFがありません。</p>
      ) : (
        <>
          {/* 年タブ */}
          <div className="flex gap-1 mb-2 flex-wrap">
            <button
              onClick={() => setSelectedYear("all")}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                selectedYear === "all" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              全年 ({allPdfs.length})
            </button>
            {years.map((y) => {
              const count = allPdfs.filter((p) => new Date(p.uploadedAt).getFullYear().toString() === y).length;
              return (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-3 py-1.5 text-xs rounded transition-colors ${
                    selectedYear === y ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  }`}
                >
                  {y}年 ({count})
                </button>
              );
            })}
          </div>

          {/* 月タブ（年を選択している場合のみ表示） */}
          {selectedYear !== "all" && (
            <div className="flex gap-1 mb-4 flex-wrap">
              <button
                onClick={() => setSelectedMonth("all")}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  selectedMonth === "all" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                全月 ({yearPdfs.length})
              </button>
              {months.map((m) => {
                const count = yearPdfs.filter((p) => String(new Date(p.uploadedAt).getMonth() + 1).padStart(2, "0") === m).length;
                return (
                  <button
                    key={m}
                    onClick={() => setSelectedMonth(m)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      selectedMonth === m ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    {parseInt(m)}月 ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* 一括操作バー */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-zinc-500">
              {filteredPdfs.length}件表示
              {selected.size > 0 && ` / ${selected.size}件選択中`}
            </span>
            {selected.size > 0 && (
              <button
                onClick={() => handleBulkDelete(Array.from(selected), `選択した${selected.size}件`)}
                disabled={deleting}
                className="text-xs text-red-400 hover:text-red-300 disabled:text-zinc-600"
              >
                {deleting ? "削除中..." : `選択を削除 (${selected.size})`}
              </button>
            )}
            {selectedYear !== "all" && (
              <button
                onClick={() => {
                  const label = selectedMonth !== "all"
                    ? `${selectedYear}年${parseInt(selectedMonth)}月の全${filteredPdfs.length}件`
                    : `${selectedYear}年の全${filteredPdfs.length}件`;
                  handleBulkDelete(filteredPdfs.map((p) => p.id), label);
                }}
                disabled={deleting}
                className="text-xs text-red-400 hover:text-red-300 disabled:text-zinc-600"
              >
                {deleting ? "削除中..." : selectedMonth !== "all"
                  ? `${parseInt(selectedMonth)}月を全削除`
                  : `${selectedYear}年を全削除`}
              </button>
            )}
          </div>

          {/* テーブル */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === filteredPdfs.length && filteredPdfs.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-zinc-600"
                    />
                  </th>
                  <th className="text-left p-3">ファイル名</th>
                  <th className="text-right p-3">サイズ</th>
                  <th className="text-center p-3">抽出</th>
                  <th className="text-left p-3">会社名</th>
                  <th className="text-left p-3">氏名</th>
                  <th className="text-right p-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredPdfs.map((pdf) => (
                  <tr key={pdf.id} className={`hover:bg-zinc-900/50 ${selected.has(pdf.id) ? "bg-zinc-900/30" : ""}`}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(pdf.id)}
                        onChange={() => toggleSelect(pdf.id)}
                        className="rounded border-zinc-600"
                      />
                    </td>
                    <td className="p-3 font-mono text-xs max-w-60 truncate">{pdf.originalFileName}</td>
                    <td className="p-3 text-right text-xs text-zinc-500">
                      {formatSize(pdf.fileSizeBytes)}
                      {pdf.pageCount && <span className="ml-1">({pdf.pageCount}p)</span>}
                    </td>
                    <td className="p-3 text-center">{statusLabel(pdf.extractStatus)}</td>
                    <td className="p-3 text-xs">{pdf.companyNameManual || pdf.companyName || <span className="text-zinc-600">-</span>}</td>
                    <td className="p-3 text-xs">{pdf.personNameManual || pdf.personName || <span className="text-zinc-600">-</span>}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteSingle(pdf.id, pdf.originalFileName)}
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
