"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

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
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [initialized, setInitialized] = useState(false);
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

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    persons.forEach((p) => p.categories?.forEach((c) => s.add(c)));
    return Array.from(s).sort();
  }, [persons]);

  const personCatMap = useMemo(() => {
    const m = new Map<string, string[]>();
    persons.forEach((p) => m.set(p.id, p.categories || []));
    return m;
  }, [persons]);

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

  useEffect(() => {
    if (!initialized && years.length > 0) {
      setSelectedYear(years[0]);
      setInitialized(true);
    }
  }, [initialized, years]);

  useEffect(() => {
    if (selectedYear && selectedYear !== "all" && months.length > 0) {
      setSelectedMonth(months[0]);
    }
  }, [selectedYear, months]);

  useEffect(() => { setSelected(new Set()); }, [selectedYear, selectedMonth, selectedCategory]);

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

  const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

  const getPersonForPdf = (pdf: PdfDocument) => persons.find((p) => p.id === pdf.personId);

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">PDF管理</h1>
          <p className="page__sub">アップロードしたPDFを絞り込んで、LINEで個別／一括配信します。</p>
        </div>
      </div>

      {/* アップロード */}
      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{ marginBottom: 16 }}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.zip" multiple onChange={handleFileInput} style={{ display: "none" }} id="pdf-upload" />
        <label htmlFor="pdf-upload" className="btn btn--primary" style={{ cursor: uploading ? "wait" : "pointer" }}>
          {uploading ? "アップロード中…" : "ファイルを選択"}
        </label>
        <p style={{ fontSize: 12, marginTop: 8, color: "var(--text-2)" }}>
          PDF / ZIP を選択、またはフォルダをドラッグ&ドロップ
        </p>
      </div>

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : allPdfs.length === 0 ? (
        <div className="empty">PDFが登録されていません。上のエリアからアップロードしてください。</div>
      ) : (
        <>
          {/* 年タブ */}
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <span className="toolbar__label">年</span>
            <button onClick={() => setSelectedYear("all")} className={`chip ${selectedYear === "all" ? "is-active" : ""}`}>
              すべて <span className="chip__count num">{allPdfs.length}</span>
            </button>
            {years.map((y) => (
              <button key={y} onClick={() => setSelectedYear(y)} className={`chip ${selectedYear === y ? "is-active" : ""}`}>
                <span className="num">{y}</span>
                <span className="chip__count num">{allPdfs.filter((p) => toYear(p.uploadedAt) === y).length}</span>
              </button>
            ))}
          </div>

          {/* 月タブ */}
          {selectedYear !== "all" && selectedYear !== "" && (
            <div className="toolbar" style={{ marginBottom: 6 }}>
              <span className="toolbar__label">月</span>
              <button onClick={() => setSelectedMonth("all")} className={`chip ${selectedMonth === "all" ? "is-active" : ""}`}>
                すべて <span className="chip__count num">{yearPdfs.length}</span>
              </button>
              {months.map((m) => (
                <button key={m} onClick={() => setSelectedMonth(m)} className={`chip ${selectedMonth === m ? "is-active" : ""}`}>
                  <span className="num">{parseInt(m)}</span>月
                  <span className="chip__count num">{yearPdfs.filter((p) => toMonth(p.uploadedAt) === m).length}</span>
                </button>
              ))}
            </div>
          )}

          {/* カテゴリ */}
          {allCategories.length > 0 && (
            <div className="toolbar" style={{ marginBottom: 14 }}>
              <span className="toolbar__label">カテゴリ</span>
              <button onClick={() => handleCategorySelect("all")} className={`chip ${selectedCategory === "all" ? "is-active" : ""}`}>
                すべて
              </button>
              {allCategories.map((c) => (
                <button key={c} onClick={() => handleCategorySelect(c)} className={`chip ${selectedCategory === c ? "is-active" : ""}`}>{c}</button>
              ))}
            </div>
          )}

          {/* 操作バー */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              <span className="num">{filteredPdfs.length}</span>
              <span> 件</span>
              {selected.size > 0 && <> / <span className="num" style={{ color: "var(--blue)" }}>{selected.size}</span> 件選択中</>}
            </div>
            {selected.size > 0 && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setShowSendModal(true)} className="btn btn--primary">
                  LINE送信 ({selected.size})
                </button>
                <button onClick={() => handleBulkDelete(Array.from(selected), `選択した${selected.size}件`)} disabled={deleting} className="btn btn--danger">
                  {deleting ? "削除中…" : "削除"}
                </button>
              </div>
            )}
          </div>

          {/* テーブル */}
          <div className="card">
            <div className="card__body card__body--flush" style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" checked={selected.size === filteredPdfs.length && filteredPdfs.length > 0} onChange={toggleSelectAll} />
                    </th>
                    <th>ファイル名</th>
                    <th>氏名</th>
                    <th>カテゴリ</th>
                    <th className="th-right">サイズ</th>
                    <th className="th-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPdfs.map((pdf) => {
                    const person = getPersonForPdf(pdf);
                    const isSel = selected.has(pdf.id);
                    return (
                      <tr key={pdf.id} className={isSel ? "is-selected" : ""}>
                        <td>
                          <input type="checkbox" checked={isSel} onChange={() => toggleSelect(pdf.id)} />
                        </td>
                        <td style={{ maxWidth: 360 }} className="truncate">{pdf.originalFileName}</td>
                        <td>{pdf.personName || <span className="text-mute">—</span>}</td>
                        <td>
                          {person?.categories?.length ? (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {person.categories.map((c) => (
                                <span key={c} className="badge badge--blue">{c}</span>
                              ))}
                            </div>
                          ) : person ? (
                            <button
                              onClick={() => { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); }}
                              className="btn btn--ghost btn--sm"
                            >
                              + 設定
                            </button>
                          ) : (
                            <span className="text-mute">—</span>
                          )}
                        </td>
                        <td className="td-right num td-muted">{formatSize(pdf.fileSizeBytes)}</td>
                        <td className="td-right">
                          {person && (
                            <button
                              onClick={() => { setEditingPerson(person); setCatInput(person.categories?.join(", ") || ""); }}
                              className="btn btn--ghost btn--sm"
                            >
                              編集
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* カテゴリ編集モーダル */}
      {editingPerson && (
        <div className="modal__backdrop" onClick={() => setEditingPerson(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <div className="modal__title">{editingPerson.name} のカテゴリ</div>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0, marginBottom: 8 }}>カンマ区切りで1〜3個（例：名古屋, 大阪）</p>
              <input type="text" className="input" value={catInput} onChange={(e) => setCatInput(e.target.value)} autoFocus placeholder="名古屋, 大阪" />
            </div>
            <div className="modal__foot">
              <button onClick={() => setEditingPerson(null)} className="btn">キャンセル</button>
              <button onClick={handleSaveCategories} className="btn btn--primary">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* LINE送信モーダル */}
      {showSendModal && (
        <SendModal selected={selected} recipients={recipients} sending={sending} onSend={handleSend} onClose={() => setShowSendModal(false)} />
      )}
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
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">LINE送信 · <span className="num">{selected.size}</span>件</div>
        </div>
        <div className="modal__body">
          <div className="field__label" style={{ marginBottom: 8 }}>送信先を選択</div>
          {recipients.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-2)", margin: 0 }}>
              有効な送信先がありません。Botにメッセージを送ってもらうと自動登録されます。
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {recipients.map((r) => {
                const isSel = chosenId === r.id;
                const isGroup = (r as Record<string, unknown>).type === "group";
                return (
                  <label
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 5,
                      cursor: "pointer",
                      border: `1px solid ${isSel ? "var(--blue-border)" : "var(--border)"}`,
                      background: isSel ? "var(--blue-soft)" : "var(--surface)",
                    }}
                  >
                    <input type="radio" name="recipient" checked={isSel} onChange={() => setChosenId(r.id)} />
                    <span style={{ fontSize: 13, flex: 1 }}>{r.displayName}</span>
                    {isGroup && <span className="badge badge--purple">グループ</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn">キャンセル</button>
          <button
            onClick={() => {
              if (!chosenId) { alert("送信先を選択してください"); return; }
              const name = recipients.find((r) => r.id === chosenId)?.displayName;
              if (confirm(`「${name}」に ${selected.size}件を LINE 送信しますか？`)) onSend(chosenId);
            }}
            disabled={sending || !chosenId}
            className="btn btn--primary"
          >
            {sending ? "送信中…" : "送信する"}
          </button>
        </div>
      </div>
    </div>
  );
}
