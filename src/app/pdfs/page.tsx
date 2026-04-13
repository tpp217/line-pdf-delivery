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
          <Link href="/" className="text-xs hover:underline" style={{ color: "var(--muted)" }}>← HOME</Link>
          <h1 className="text-lg font-bold mt-1 tracking-widest uppercase" style={{ color: "var(--cyan)" }}>PDF管理</h1>
        </div>
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`cyber-dropzone mb-6 ${dragging ? "dragging" : ""}`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple onChange={handleFileInput} className="hidden" id="pdf-upload" />
        <label htmlFor="pdf-upload" className={`btn-cyan inline-block cursor-pointer ${uploading ? "opacity-50 cursor-wait" : ""}`}>
          {uploading ? "UPLOADING..." : "SELECT FILES"}
        </label>
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>PDF・ZIP選択、またはフォルダをD&D</p>
      </div>

      {loading ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>LOADING...</p>
      ) : allPdfs.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>NO PDF FILES FOUND.</p>
      ) : (
        <>
          {/* 年タブ */}
          <div className="flex gap-1 mb-2 flex-wrap">
            <button onClick={() => setSelectedYear("all")} className={`cyber-tab ${selectedYear === "all" ? "active" : ""}`}>
              ALL ({allPdfs.length})
            </button>
            {years.map((y) => (
              <button key={y} onClick={() => setSelectedYear(y)} className={`cyber-tab ${selectedYear === y ? "active" : ""}`}>
                {y} ({allPdfs.filter((p) => toYear(p.uploadedAt) === y).length})
              </button>
            ))}
          </div>

          {/* 月タブ */}
          {selectedYear !== "all" && (
            <div className="flex gap-1 mb-2 flex-wrap">
              <button onClick={() => setSelectedMonth("all")} className={`cyber-tab ${selectedMonth === "all" ? "active" : ""}`}>
                ALL ({yearPdfs.length})
              </button>
              {months.map((m) => (
                <button key={m} onClick={() => setSelectedMonth(m)} className={`cyber-tab ${selectedMonth === m ? "active" : ""}`}>
                  {parseInt(m)}M ({yearPdfs.filter((p) => toMonth(p.uploadedAt) === m).length})
                </button>
              ))}
            </div>
          )}

          {/* カテゴリフィルタ */}
          {allCategories.length > 0 && (
            <div className="flex gap-1 mb-4 flex-wrap items-center">
              <span className="text-xs mr-1 cyber-title">CATEGORY:</span>
              <button onClick={() => handleCategorySelect("all")} className={`cyber-tab ${selectedCategory === "all" ? "active" : ""}`}>
                ALL
              </button>
              {allCategories.map((c) => (
                <button key={c} onClick={() => handleCategorySelect(c)} className={`cyber-tab ${selectedCategory === c ? "active" : ""}`}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* 操作バー */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {filteredPdfs.length} FILES{selected.size > 0 && ` / ${selected.size} SELECTED`}
            </span>
            {selected.size > 0 && (
              <>
                <button onClick={() => setShowSendModal(true)} className="btn-magenta">
                  LINE SEND ({selected.size})
                </button>
                <button
                  onClick={() => handleBulkDelete(Array.from(selected), `選択した${selected.size}件`)}
                  disabled={deleting}
                  className="text-xs"
                  style={{ color: "#ff4444" }}
                >
                  {deleting ? "DELETING..." : "DELETE"}
                </button>
              </>
            )}
          </div>

          {/* テーブル */}
          <div className="cyber-card overflow-hidden">
            <table className="cyber-table">
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}>
                    <input type="checkbox" checked={selected.size === filteredPdfs.length && filteredPdfs.length > 0} onChange={toggleSelectAll} />
                  </th>
                  <th>FILE NAME</th>
                  <th>NAME</th>
                  <th>CATEGORY</th>
                  <th style={{ textAlign: "right" }}>SIZE</th>
                  <th style={{ textAlign: "right" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredPdfs.map((pdf) => {
                  const person = getPersonForPdf(pdf);
                  return (
                    <tr key={pdf.id} style={selected.has(pdf.id) ? { background: "rgba(0,255,255,0.05)" } : {}}>
                      <td>
                        <input type="checkbox" checked={selected.has(pdf.id)} onChange={() => toggleSelect(pdf.id)} />
                      </td>
                      <td className="max-w-48 truncate" style={{ fontSize: "0.75rem" }}>{pdf.originalFileName}</td>
                      <td style={{ fontSize: "0.75rem" }}>{pdf.personName || "-"}</td>
                      <td style={{ fontSize: "0.75rem" }}>
                        {person?.categories?.length ? (
                          <div className="flex gap-1 flex-wrap">
                            {person.categories.map((c) => (
                              <span key={c} className="cyber-badge">{c}</span>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={() => { if (person) { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); } }}
                            style={{ color: "var(--muted)", fontSize: "0.7rem" }}
                          >
                            {person ? "+ SET" : "-"}
                          </button>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--muted)" }}>{formatSize(pdf.fileSizeBytes)}</td>
                      <td style={{ textAlign: "right" }}>
                        {person && (
                          <button
                            onClick={() => { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); }}
                            style={{ fontSize: "0.7rem", color: "var(--cyan)" }}
                            className="hover:opacity-70 mr-2"
                          >
                            EDIT
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
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.75)" }} onClick={() => setEditingPerson(null)}>
          <div className="cyber-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingPerson.name} // CATEGORY</h3>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>カンマ区切りで1〜3個 (例: 名古屋, 大阪)</p>
            <input
              type="text"
              value={catInput}
              onChange={(e) => setCatInput(e.target.value)}
              className="cyber-input mb-4"
              placeholder="名古屋, 大阪"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={handleSaveCategories} className="btn-cyan">SAVE</button>
              <button onClick={() => setEditingPerson(null)} className="btn-ghost">CANCEL</button>
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
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="cyber-modal" onClick={(e) => e.stopPropagation()}>
        <h3>LINE SEND // {selected.size} FILES</h3>

        <div className="mb-4">
          <label className="cyber-title block mb-2">SELECT RECIPIENT</label>
          {recipients.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>有効な送信先がありません。Bot にメッセージを送ってもらうと自動登録されます。</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recipients.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors"
                  style={{
                    border: `1px solid ${chosenId === r.id ? "var(--cyan)" : "var(--border)"}`,
                    background: chosenId === r.id ? "rgba(0,255,255,0.08)" : "transparent",
                    boxShadow: chosenId === r.id ? "var(--glow-cyan)" : "none",
                  }}
                >
                  <input
                    type="radio"
                    name="recipient"
                    checked={chosenId === r.id}
                    onChange={() => setChosenId(r.id)}
                  />
                  <span className="text-sm">{r.displayName}</span>
                  {(r as Record<string, unknown>).type === 'group' && (
                    <span className="cyber-badge-mag ml-2">GROUP</span>
                  )}
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
            className="btn-magenta"
            style={{ opacity: sending || !chosenId ? 0.5 : 1 }}
          >
            {sending ? "SENDING..." : "SEND"}
          </button>
          <button onClick={onClose} className="btn-ghost">CANCEL</button>
        </div>
      </div>
    </div>
  );
}
