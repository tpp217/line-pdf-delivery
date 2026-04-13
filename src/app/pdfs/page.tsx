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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.25rem 0.65rem",
    fontSize: "0.7rem",
    borderRadius: "4px",
    border: `1px solid ${active ? "#00ffff" : "rgba(0,255,255,0.15)"}`,
    background: active ? "#00ffff" : "transparent",
    color: active ? "#0a0a0f" : "#4a5568",
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Courier New',monospace", padding: "1.5rem" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <Link href="/" style={{ color: "#4a5568", fontSize: "0.7rem", textDecoration: "none" }}>← HOME</Link>
          <h1 style={{ fontSize: "1.2rem", fontWeight: "bold", letterSpacing: "0.12em", textTransform: "uppercase", color: "#00ffff", marginTop: "0.25rem" }}>PDF管理</h1>
        </div>

        {/* ドロップゾーン */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{ border: `2px dashed ${dragging ? "#00ffff" : "rgba(0,255,255,0.2)"}`, borderRadius: "6px", padding: "1.5rem", textAlign: "center", marginBottom: "1.25rem", boxShadow: dragging ? "0 0 8px rgba(0,255,255,0.4)" : "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple onChange={handleFileInput} style={{ display: "none" }} id="pdf-upload" />
          <label htmlFor="pdf-upload" style={{ background: "transparent", border: "1px solid #00ffff", color: uploading ? "#4a5568" : "#00ffff", padding: "0.35rem 1rem", borderRadius: "4px", cursor: uploading ? "wait" : "pointer", fontSize: "0.75rem", fontFamily: "inherit", display: "inline-block" }}>
            {uploading ? "UPLOADING..." : "SELECT FILES"}
          </label>
          <p style={{ fontSize: "0.7rem", marginTop: "0.5rem", color: "#4a5568" }}>PDF・ZIP選択、またはフォルダをD&D</p>
        </div>

        {loading ? (
          <p style={{ color: "#4a5568", fontSize: "0.8rem" }}>LOADING...</p>
        ) : allPdfs.length === 0 ? (
          <p style={{ color: "#4a5568", fontSize: "0.8rem" }}>NO PDF FILES FOUND.</p>
        ) : (
          <>
            {/* 年タブ */}
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <button onClick={() => setSelectedYear("all")} style={tabStyle(selectedYear === "all")}>ALL ({allPdfs.length})</button>
              {years.map((y) => (
                <button key={y} onClick={() => setSelectedYear(y)} style={tabStyle(selectedYear === y)}>
                  {y} ({allPdfs.filter((p) => toYear(p.uploadedAt) === y).length})
                </button>
              ))}
            </div>

            {/* 月タブ */}
            {selectedYear !== "all" && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <button onClick={() => setSelectedMonth("all")} style={tabStyle(selectedMonth === "all")}>ALL ({yearPdfs.length})</button>
                {months.map((m) => (
                  <button key={m} onClick={() => setSelectedMonth(m)} style={tabStyle(selectedMonth === m)}>
                    {parseInt(m)}M ({yearPdfs.filter((p) => toMonth(p.uploadedAt) === m).length})
                  </button>
                ))}
              </div>
            )}

            {/* カテゴリフィルタ */}
            {allCategories.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
                <span style={{ fontSize: "0.7rem", color: "#00ffff", letterSpacing: "0.1em", marginRight: "0.25rem" }}>CATEGORY:</span>
                <button onClick={() => handleCategorySelect("all")} style={tabStyle(selectedCategory === "all")}>ALL</button>
                {allCategories.map((c) => (
                  <button key={c} onClick={() => handleCategorySelect(c)} style={tabStyle(selectedCategory === c)}>{c}</button>
                ))}
              </div>
            )}

            {/* 操作バー */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.75rem", color: "#4a5568" }}>
                {filteredPdfs.length} FILES{selected.size > 0 && ` / ${selected.size} SELECTED`}
              </span>
              {selected.size > 0 && (
                <>
                  <button onClick={() => setShowSendModal(true)} style={{ background: "transparent", border: "1px solid #ff00ff", color: "#ff00ff", padding: "0.3rem 0.75rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>
                    LINE SEND ({selected.size})
                  </button>
                  <button onClick={() => handleBulkDelete(Array.from(selected), `選択した${selected.size}件`)} disabled={deleting} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>
                    {deleting ? "DELETING..." : "DELETE"}
                  </button>
                </>
              )}
            </div>

            {/* テーブル */}
            <div style={{ border: "1px solid rgba(0,255,255,0.15)", borderRadius: "6px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th style={{ background: "#111827", color: "#00ffff", fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0.6rem 0.75rem", borderBottom: "1px solid rgba(0,255,255,0.2)", width: "2rem" }}>
                      <input type="checkbox" checked={selected.size === filteredPdfs.length && filteredPdfs.length > 0} onChange={toggleSelectAll} />
                    </th>
                    {["FILE NAME","NAME","CATEGORY","SIZE","ACTION"].map((h, i) => (
                      <th key={h} style={{ background: "#111827", color: "#00ffff", fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0.6rem 0.75rem", borderBottom: "1px solid rgba(0,255,255,0.2)", textAlign: i >= 3 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPdfs.map((pdf) => {
                    const person = getPersonForPdf(pdf);
                    const td: React.CSSProperties = { padding: "0.6rem 0.75rem", color: "#e2e8f0", borderBottom: "1px solid rgba(0,255,255,0.07)" };
                    return (
                      <tr key={pdf.id} style={selected.has(pdf.id) ? { background: "rgba(0,255,255,0.05)" } : {}}>
                        <td style={td}><input type="checkbox" checked={selected.has(pdf.id)} onChange={() => toggleSelect(pdf.id)} /></td>
                        <td style={{ ...td, fontSize: "0.75rem", maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdf.originalFileName}</td>
                        <td style={{ ...td, fontSize: "0.75rem" }}>{pdf.personName || "-"}</td>
                        <td style={{ ...td, fontSize: "0.75rem" }}>
                          {person?.categories?.length ? (
                            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                              {person.categories.map((c) => (
                                <span key={c} style={{ border: "1px solid #00ffff", color: "#00ffff", fontSize: "0.65rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "rgba(0,255,255,0.06)" }}>{c}</span>
                              ))}
                            </div>
                          ) : (
                            <button onClick={() => { if (person) { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); } }} style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}>
                              {person ? "+ SET" : "-"}
                            </button>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right", fontSize: "0.75rem", color: "#4a5568" }}>{formatSize(pdf.fileSizeBytes)}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {person && (
                            <button onClick={() => { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); }} style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}>EDIT</button>
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
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setEditingPerson(null)}>
            <div style={{ background: "#0d1117", border: "1px solid #00ffff", boxShadow: "0 0 12px rgba(0,255,255,0.4)", borderRadius: "6px", padding: "1.5rem", width: "22rem", fontFamily: "inherit" }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ color: "#00ffff", fontSize: "0.8rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem", borderBottom: "1px solid rgba(0,255,255,0.2)", paddingBottom: "0.5rem" }}>{editingPerson.name} // CATEGORY</h3>
              <p style={{ fontSize: "0.7rem", color: "#4a5568", marginBottom: "0.75rem" }}>カンマ区切りで1〜3個 (例: 名古屋, 大阪)</p>
              <input type="text" value={catInput} onChange={(e) => setCatInput(e.target.value)} autoFocus placeholder="名古屋, 大阪" style={{ background: "#111827", border: "1px solid rgba(0,255,255,0.2)", color: "#e2e8f0", borderRadius: "4px", padding: "0.45rem 0.75rem", fontSize: "0.8rem", width: "100%", outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "1rem" }} />
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button onClick={handleSaveCategories} style={{ background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "0.35rem 1rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>SAVE</button>
                <button onClick={() => setEditingPerson(null)} style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* LINE 送信モーダル */}
        {showSendModal && (
          <SendModal selected={selected} recipients={recipients} sending={sending} onSend={handleSend} onClose={() => setShowSendModal(false)} />
        )}
      </div>
    </div>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#0d1117", border: "1px solid #00ffff", boxShadow: "0 0 12px rgba(0,255,255,0.4)", borderRadius: "6px", padding: "1.5rem", width: "22rem", fontFamily: "'JetBrains Mono','Courier New',monospace" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: "#00ffff", fontSize: "0.8rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem", borderBottom: "1px solid rgba(0,255,255,0.2)", paddingBottom: "0.5rem" }}>LINE SEND // {selected.size} FILES</h3>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", fontSize: "0.7rem", color: "#00ffff", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>SELECT RECIPIENT</label>
          {recipients.length === 0 ? (
            <p style={{ fontSize: "0.75rem", color: "#4a5568" }}>有効な送信先がありません。Botにメッセージを送ってもらうと自動登録されます。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "12rem", overflowY: "auto" }}>
              {recipients.map((r) => (
                <label key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: "4px", cursor: "pointer", border: `1px solid ${chosenId === r.id ? "#00ffff" : "rgba(0,255,255,0.15)"}`, background: chosenId === r.id ? "rgba(0,255,255,0.06)" : "transparent" }}>
                  <input type="radio" name="recipient" checked={chosenId === r.id} onChange={() => setChosenId(r.id)} />
                  <span style={{ fontSize: "0.8rem" }}>{r.displayName}</span>
                  {(r as Record<string, unknown>).type === "group" && (
                    <span style={{ border: "1px solid #ff00ff", color: "#ff00ff", fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: "3px" }}>GROUP</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={() => {
              if (!chosenId) { alert("送信先を選択してください"); return; }
              const name = recipients.find((r) => r.id === chosenId)?.displayName;
              if (confirm(`「${name}」に ${selected.size}件を LINE 送信しますか？`)) onSend(chosenId);
            }}
            disabled={sending || !chosenId}
            style={{ background: "transparent", border: "1px solid #ff00ff", color: "#ff00ff", padding: "0.35rem 1rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", opacity: sending || !chosenId ? 0.5 : 1 }}
          >
            {sending ? "SENDING..." : "SEND"}
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>CANCEL</button>
        </div>
      </div>
    </div>
  );
}
