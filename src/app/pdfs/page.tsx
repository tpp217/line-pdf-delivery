"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";

type PdfDocument = {
  id: string;
  originalFileName: string;
  fileSizeBytes: number;
  personName: string | null;
  personId: string | null;
  uploadedAt: string;
};

type Person = {
  id: string;
  name: string;
  categories: string[];
};

type Recipient = {
  id: string;
  displayName: string;
  isActive: boolean;
};

async function readAllEntries(entry: FileSystemEntry, result: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) => (entry as FileSystemFileEntry).file(resolve));
    result.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[] = [];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve));
      for (const child of batch) await readAllEntries(child, result);
    } while (batch.length > 0);
  }
}

function toYear(d: string) { return new Date(d).getFullYear().toString(); }
function toMonth(d: string) { return String(new Date(d).getMonth() + 1).padStart(2, "0"); }

export default function PdfsPage() {
  const [allPdfs, setAllPdfs] = useState<PdfDocument[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSendModal, setShowSendModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [catInput, setCatInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [pRes, persRes, rRes] = await Promise.all([
      fetch("/api/v1/pdfs?page=1&pageSize=1000"),
      fetch("/api/v1/persons"),
      fetch("/api/v1/recipients?isActive=true"),
    ]);
    const pData = await pRes.json();
    setAllPdfs(pData.items || []);
    setPersons(await persRes.json());
    setRecipients(await rRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // カテゴリ一覧
  const allCategories = useMemo(() => {
    const s = new Set<string>();
    persons.forEach((p) => p.categories?.forEach((c) => s.add(c)));
    return Array.from(s).sort();
  }, [persons]);

  // 人物 → カテゴリのマップ
  const personCatMap = useMemo(() => {
    const m = new Map<string, string[]>();
    persons.forEach((p) => m.set(p.id, p.categories || []));
    return m;
  }, [persons]);

  // フィルタ
  const years = useMemo(() => {
    const s = new Set<string>();
    allPdfs.forEach((p) => s.add(toYear(p.uploadedAt)));
    return Array.from(s).sort().reverse();
  }, [allPdfs]);

  const yearPdfs = useMemo(() => {
    if (selectedYear === "all") return allPdfs;
    return allPdfs.filter((p) => toYear(p.uploadedAt) === selectedYear);
  }, [allPdfs, selectedYear]);

  const months = useMemo(() => {
    const s = new Set<string>();
    yearPdfs.forEach((p) => s.add(toMonth(p.uploadedAt)));
    return Array.from(s).sort().reverse();
  }, [yearPdfs]);

  const filteredPdfs = useMemo(() => {
    let result = selectedMonth === "all" ? yearPdfs : yearPdfs.filter((p) => toMonth(p.uploadedAt) === selectedMonth);
    if (selectedCategory !== "all") {
      result = result.filter((p) => {
        const cats = p.personId ? personCatMap.get(p.personId) : [];
        return cats?.includes(selectedCategory);
      });
    }
    return result;
  }, [yearPdfs, selectedMonth, selectedCategory, personCatMap]);

  useEffect(() => { setSelectedMonth("all"); }, [selectedYear]);
  useEffect(() => { setSelected(new Set()); }, [selectedYear, selectedMonth, selectedCategory]);

  // カテゴリ選択で一括チェック
  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === "all") {
      setSelected(new Set());
    } else {
      const ids = filteredPdfs
        .filter((p) => p.personId && personCatMap.get(p.personId)?.includes(cat))
        .map((p) => p.id);
      setSelected(new Set(ids));
    }
  };

  // アップロード
  const uploadFiles = useCallback(async (files: File[], folderName?: string) => {
    if (files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    formData.append("sourceFolderName", folderName || "ブラウザアップロード");
    try {
      const res = await fetch("/api/v1/uploads/folder", { method: "POST", body: formData });
      if (res.ok) {
        const r = await res.json();
        alert(`${r.acceptedFiles}件のPDFを登録しました`);
        fetchData();
      } else {
        alert(`エラー: ${(await res.json()).error}`);
      }
    } catch (e) { alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`); }
    setUploading(false);
  }, [fetchData]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;
    const allFiles: File[] = [];
    const entries = Array.from(items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    for (const entry of entries) await readAllEntries(entry, allFiles);
    if (allFiles.length === 0) { uploadFiles(Array.from(e.dataTransfer.files)); return; }
    uploadFiles(allFiles, entries.find((e) => e.isDirectory)?.name);
  };

  // 削除
  const handleBulkDelete = async (ids: string[], label: string) => {
    if (!confirm(`${label} (${ids.length}件) を削除しますか？`)) return;
    setDeleting(true);
    await fetch("/api/v1/pdfs/bulk-delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    await fetchData();
    setDeleting(false);
  };

  // LINE 送信
  const handleSend = async (recipientId: string) => {
    setSending(true);
    const res = await fetch("/api/v1/pdfs/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfIds: Array.from(selected), recipientId }),
    });
    const result = await res.json();
    if (res.ok) {
      alert(`送信完了: 成功${result.success}件 / 失敗${result.failed}件`);
    } else {
      alert(`エラー: ${result.error}`);
    }
    setSending(false);
    setShowSendModal(false);
  };

  // カテゴリ編集
  const handleSaveCategories = async () => {
    if (!editingPerson) return;
    const cats = catInput.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean);
    await fetch(`/api/v1/persons/${editingPerson.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: cats }),
    });
    setEditingPerson(null);
    setCatInput("");
    fetchData();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelected(selected.size === filteredPdfs.length ? new Set() : new Set(filteredPdfs.map((p) => p.id)));
  };

  const formatSize = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`;

  const getPersonForPdf = (pdf: PdfDocument) => persons.find((p) => p.id === pdf.personId);

  return (
    <main className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-zinc-500 text-xs hover:text-zinc-300">← ホーム</Link>
          <h1 className="text-xl font-bold mt-1">PDF管理</h1>
        </div>
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 mb-6 text-center transition-colors ${dragging ? "border-zinc-400 bg-zinc-900" : "border-zinc-700 hover:border-zinc-600"}`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple onChange={handleFileInput} className="hidden" id="pdf-upload" />
        <label htmlFor="pdf-upload" className={`inline-block px-5 py-2 text-sm font-medium rounded cursor-pointer transition-colors ${uploading ? "bg-zinc-700 text-zinc-400 cursor-wait" : "bg-zinc-100 text-zinc-900 hover:bg-white"}`}>
          {uploading ? "アップロード中..." : "ファイルを選択"}
        </label>
        <p className="text-zinc-500 text-xs mt-2">PDF・ZIP選択、またはフォルダをD&D</p>
      </div>

      {loading ? <p className="text-zinc-500 text-sm">読み込み中...</p> : allPdfs.length === 0 ? <p className="text-zinc-500 text-sm">PDFがありません。</p> : (
        <>
          {/* 年タブ */}
          <div className="flex gap-1 mb-2 flex-wrap">
            <button onClick={() => setSelectedYear("all")} className={`px-3 py-1.5 text-xs rounded ${selectedYear === "all" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
              全年 ({allPdfs.length})
            </button>
            {years.map((y) => (
              <button key={y} onClick={() => setSelectedYear(y)} className={`px-3 py-1.5 text-xs rounded ${selectedYear === y ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
                {y}年 ({allPdfs.filter((p) => toYear(p.uploadedAt) === y).length})
              </button>
            ))}
          </div>

          {/* 月タブ */}
          {selectedYear !== "all" && (
            <div className="flex gap-1 mb-2 flex-wrap">
              <button onClick={() => setSelectedMonth("all")} className={`px-3 py-1.5 text-xs rounded ${selectedMonth === "all" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
                全月 ({yearPdfs.length})
              </button>
              {months.map((m) => (
                <button key={m} onClick={() => setSelectedMonth(m)} className={`px-3 py-1.5 text-xs rounded ${selectedMonth === m ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
                  {parseInt(m)}月 ({yearPdfs.filter((p) => toMonth(p.uploadedAt) === m).length})
                </button>
              ))}
            </div>
          )}

          {/* カテゴリフィルタ */}
          {allCategories.length > 0 && (
            <div className="flex gap-1 mb-4 flex-wrap items-center">
              <span className="text-xs text-zinc-500 mr-1">カテゴリ:</span>
              <button onClick={() => handleCategorySelect("all")} className={`px-3 py-1.5 text-xs rounded ${selectedCategory === "all" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
                全て
              </button>
              {allCategories.map((c) => (
                <button key={c} onClick={() => handleCategorySelect(c)} className={`px-3 py-1.5 text-xs rounded ${selectedCategory === c ? "bg-emerald-600 text-white font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* 操作バー */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-xs text-zinc-500">
              {filteredPdfs.length}件{selected.size > 0 && ` / ${selected.size}件選択`}
            </span>
            {selected.size > 0 && (
              <>
                <button onClick={() => setShowSendModal(true)} className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-500">
                  LINE送信 ({selected.size})
                </button>
                <button
                  onClick={() => handleBulkDelete(Array.from(selected), `選択した${selected.size}件`)}
                  disabled={deleting}
                  className="text-xs text-red-400 hover:text-red-300 disabled:text-zinc-600"
                >
                  {deleting ? "削除中..." : "削除"}
                </button>
              </>
            )}
          </div>

          {/* テーブル */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  <th className="p-3 w-8">
                    <input type="checkbox" checked={selected.size === filteredPdfs.length && filteredPdfs.length > 0} onChange={toggleSelectAll} className="rounded border-zinc-600" />
                  </th>
                  <th className="text-left p-3">ファイル名</th>
                  <th className="text-left p-3">氏名</th>
                  <th className="text-left p-3">カテゴリ</th>
                  <th className="text-right p-3">サイズ</th>
                  <th className="text-right p-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredPdfs.map((pdf) => {
                  const person = getPersonForPdf(pdf);
                  return (
                    <tr key={pdf.id} className={`hover:bg-zinc-900/50 ${selected.has(pdf.id) ? "bg-zinc-900/30" : ""}`}>
                      <td className="p-3">
                        <input type="checkbox" checked={selected.has(pdf.id)} onChange={() => toggleSelect(pdf.id)} className="rounded border-zinc-600" />
                      </td>
                      <td className="p-3 text-xs max-w-48 truncate">{pdf.originalFileName}</td>
                      <td className="p-3 text-xs">{pdf.personName || "-"}</td>
                      <td className="p-3 text-xs">
                        {person?.categories?.length ? (
                          <div className="flex gap-1 flex-wrap">
                            {person.categories.map((c) => (
                              <span key={c} className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-xs">{c}</span>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={() => { if (person) { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); } }}
                            className="text-zinc-600 hover:text-zinc-400 text-xs"
                          >
                            {person ? "+ 設定" : "-"}
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-right text-xs text-zinc-500">{formatSize(pdf.fileSizeBytes)}</td>
                      <td className="p-3 text-right">
                        {person && (
                          <button
                            onClick={() => { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); }}
                            className="text-xs text-zinc-400 hover:text-zinc-100 mr-2"
                          >
                            カテゴリ
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* カテゴリ編集モーダル */}
      {editingPerson && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditingPerson(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">{editingPerson.name} のカテゴリ</h3>
            <p className="text-xs text-zinc-500 mb-4">カンマ区切りで1〜3個 (例: 名古屋, 大阪)</p>
            <input
              type="text"
              value={catInput}
              onChange={(e) => setCatInput(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 mb-4"
              placeholder="名古屋, 大阪"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={handleSaveCategories} className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white">保存</button>
              <button onClick={() => setEditingPerson(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* LINE 送信モーダル */}
      {showSendModal && (
        <SendModal
          selected={selected}
          recipients={recipients}
          sending={sending}
          onSend={handleSend}
          onClose={() => setShowSendModal(false)}
        />
      )}
    </main>
  );
}

function SendModal({
  selected,
  recipients,
  sending,
  onSend,
  onClose,
}: {
  selected: Set<string>;
  recipients: Recipient[];
  sending: boolean;
  onSend: (recipientId: string) => void;
  onClose: () => void;
}) {
  const [chosenId, setChosenId] = useState<string>("");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-4">LINE 送信</h3>

        <div className="mb-4">
          <p className="text-xs text-zinc-400 mb-2">送信するPDF: {selected.size}件</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-2">送信先を選択</label>
          {recipients.length === 0 ? (
            <p className="text-xs text-zinc-500">有効な送信先がありません。Bot にメッセージを送ってもらうと自動登録されます。</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recipients.map((r) => (
                <label
                  key={r.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border rounded cursor-pointer transition-colors ${
                    chosenId === r.id
                      ? "border-emerald-500 bg-emerald-900/20"
                      : "border-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="recipient"
                    checked={chosenId === r.id}
                    onChange={() => setChosenId(r.id)}
                    className="text-emerald-500"
                  />
                  <span className="text-sm">{r.displayName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (!chosenId) { alert("送信先を選択してください"); return; }
              const name = recipients.find((r) => r.id === chosenId)?.displayName;
              if (confirm(`「${name}」に ${selected.size}件を LINE 送信しますか？`)) {
                onSend(chosenId);
              }
            }}
            disabled={sending || !chosenId}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {sending ? "送信中..." : "送信"}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
