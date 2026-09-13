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

type CategoryRecipientMap = Record<string, string[]>;

type MatchReason = "exact" | "prefix" | "fuzzy";

type MatchCandidate = {
  person: { id: string; name: string; categories: string[] };
  reason: MatchReason;
  score: number;
};

type MatchGroup = {
  person: { id: string; name: string; categories: string[] };
  candidates: MatchCandidate[];
};

// カテゴリ未設定を表す擬似カテゴリ。
// 未設定の人物は従来カテゴリ絞り込みから「消える」だけだったので、
// 一括送信から漏れていることに気づけなかった。明示的に選べるようにする。
const UNCATEGORIZED = "__uncategorized__";

const REASON_LABEL: Record<MatchReason, string> = {
  exact: "完全一致",
  prefix: "姓のみ / フルネーム",
  fuzzy: "表記ゆれの疑い",
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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSendModal, setShowSendModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [catInput, setCatInput] = useState("");
  const [editingCats, setEditingCats] = useState<string[]>([]);
  const [catRecipientMap, setCatRecipientMap] = useState<CategoryRecipientMap>({});
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([]);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [resolving, setResolving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [pRes, persRes, rRes, crRes, mRes] = await Promise.all([
      fetch("/api/v1/pdfs?page=1&pageSize=1000"),
      fetch("/api/v1/persons"),
      fetch("/api/v1/recipients?isActive=true"),
      fetch("/api/v1/category-recipients"),
      fetch("/api/v1/persons/match"),
    ]);
    const pData = await pRes.json();
    setAllPdfs(pData.items || []);
    setPersons(await persRes.json());
    setRecipients(await rRes.json());
    const crData = await crRes.json();
    const map: CategoryRecipientMap = {};
    for (const it of (crData.items ?? []) as { category: string; recipientIds: string[] }[]) {
      map[it.category] = it.recipientIds;
    }
    setCatRecipientMap(map);
    const mData = await mRes.json();
    setMatchGroups((mData.items ?? []) as MatchGroup[]);
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

  // PDF に紐づく人物のカテゴリ。人物が未解決／カテゴリ未設定なら空配列。
  const catsOf = useCallback(
    (p: PdfDocument) => (p.personId ? personCatMap.get(p.personId) ?? [] : []),
    [personCatMap],
  );

  // 選択カテゴリに合致するか。カテゴリ未設定のPDFは「未分類」を選んだときだけ残る。
  const matchesSelection = useCallback(
    (p: PdfDocument, sel: string[]) => {
      const cats = catsOf(p);
      if (cats.length === 0) return sel.includes(UNCATEGORIZED);
      return cats.some((c) => sel.includes(c));
    },
    [catsOf],
  );

  // 「選択順でソート」用の順位。未分類は擬似カテゴリの選択位置を使う。
  const selectionRank = useCallback(
    (p: PdfDocument, sel: string[]) => {
      const cats = catsOf(p);
      if (cats.length === 0) return sel.indexOf(UNCATEGORIZED);
      let best = Number.MAX_SAFE_INTEGER;
      for (const c of cats) {
        const i = sel.indexOf(c);
        if (i >= 0 && i < best) best = i;
      }
      return best === Number.MAX_SAFE_INTEGER ? sel.length : best;
    },
    [catsOf],
  );

  const monthPdfs = useMemo(
    () =>
      selectedMonth === "all"
        ? yearPdfs
        : yearPdfs.filter((p) => toMonth(p.uploadedAt) === selectedMonth),
    [yearPdfs, selectedMonth],
  );

  // 現在の年月スコープでカテゴリが付いていないPDFの件数。
  // 0 でなければカテゴリ絞り込み＝一括送信から漏れる可能性がある。
  const uncategorizedCount = useMemo(
    () => monthPdfs.filter((p) => catsOf(p).length === 0).length,
    [monthPdfs, catsOf],
  );

  // 選択中のPDFのうちカテゴリ未設定のもの（送信前の警告に使う）。
  const selectedUncategorized = useMemo(
    () => allPdfs.filter((p) => selected.has(p.id) && catsOf(p).length === 0).length,
    [allPdfs, selected, catsOf],
  );

  const filteredPdfs = useMemo(() => {
    if (selectedCategories.length === 0) return monthPdfs;
    // OR 絞り込み：選択カテゴリのどれかに属する人物のPDFを残す
    const result = monthPdfs.filter((p) => matchesSelection(p, selectedCategories));
    // 選択順でソート → 同カテゴリ内は氏名 → ファイル名
    return [...result].sort((a, b) => {
      const aIdx = selectionRank(a, selectedCategories);
      const bIdx = selectionRank(b, selectedCategories);
      if (aIdx !== bIdx) return aIdx - bIdx;
      const aName = a.personName ?? "";
      const bName = b.personName ?? "";
      if (aName !== bName) return aName.localeCompare(bName, "ja");
      return a.originalFileName.localeCompare(b.originalFileName, "ja");
    });
  }, [monthPdfs, selectedCategories, matchesSelection, selectionRank]);

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

  useEffect(() => { setSelected(new Set()); }, [selectedYear, selectedMonth]);

  // カテゴリトグル：選択中のカテゴリは選択順に配列で保持
  const handleToggleCategory = (cat: string) => {
    const next = selectedCategories.includes(cat)
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];
    setSelectedCategories(next);
    // カテゴリ絞込み後のPDFをまとめて選択状態にする（一括送信のショートカット）
    if (next.length === 0) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(monthPdfs.filter((p) => matchesSelection(p, next)).map((p) => p.id)));
  };

  const handleClearCategories = () => {
    setSelectedCategories([]);
    setSelected(new Set());
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
        const reused = (r.matchedByName ?? 0) + (r.matchedByAlias ?? 0);
        const skipped = r.skippedDuplicates ?? 0;
        alert(
          [
            r.acceptedFiles > 0
              ? `${r.acceptedFiles}件のPDFを登録しました`
              : "新しく登録したPDFはありません",
            skipped > 0
              ? `${skipped}件は中身が既存のPDFと同一のためスキップしました`
              : null,
            reused > 0 ? `既存の人物に紐付け: ${reused}件` : null,
            r.newPersons > 0
              ? `新しい人物として登録: ${r.newPersons}件\n（同一人物の可能性があるものは「要確認」から確定できます）`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
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

  const handleSend = async (recipientIds: string[]) => {
    setSending(true);
    const res = await fetch("/api/v1/pdfs/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfIds: Array.from(selected), recipient_ids: recipientIds }),
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

  const openEditPerson = (person: Person) => {
    setEditingPerson(person);
    setEditingCats(person.categories ?? []);
    setCatInput("");
  };

  const toggleEditingCat = (cat: string) => {
    setEditingCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const addNewCategoryFromInput = () => {
    const tokens = catInput.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    setEditingCats((prev) => {
      const next = [...prev];
      for (const t of tokens) if (!next.includes(t)) next.push(t);
      return next;
    });
    setCatInput("");
  };

  const handleSaveCategories = async () => {
    if (!editingPerson) return;
    await fetch(`/api/v1/persons/${editingPerson.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: editingCats }),
    });
    setEditingPerson(null);
    setCatInput("");
    setEditingCats([]);
    fetchData();
  };

  // 「要確認」の確定。merge = 同一人物として統合、separate = 別人として以後出さない。
  // 統合しても pdf_documents.personName は書き換えないので、LINE に届く文面は変わらない。
  const resolveMatch = async (
    action: "merge" | "separate",
    sourceId: string,
    targetId: string,
  ) => {
    setResolving(true);
    try {
      const res = await fetch("/api/v1/persons/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceId, targetId }),
      });
      if (!res.ok) {
        alert(`エラー: ${(await res.json()).error ?? "不明"}`);
        return;
      }
      await fetchData();
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    } finally {
      setResolving(false);
    }
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

          {/* カテゴリ（複数選択・選択順でソート） */}
          {(allCategories.length > 0 || uncategorizedCount > 0) && (
            <div className="toolbar" style={{ marginBottom: 14 }}>
              <span className="toolbar__label">カテゴリ</span>
              <button
                onClick={handleClearCategories}
                className={`chip ${selectedCategories.length === 0 ? "is-active" : ""}`}
              >
                すべて
              </button>
              {allCategories.map((c) => {
                const idx = selectedCategories.indexOf(c);
                const isActive = idx >= 0;
                return (
                  <button
                    key={c}
                    onClick={() => handleToggleCategory(c)}
                    className={`chip ${isActive ? "is-active" : ""}`}
                  >
                    {isActive && <span className="chip__count num">{idx + 1}</span>}
                    {c}
                  </button>
                );
              })}
              {/* 未分類：カテゴリが付いていない＝一括送信から漏れるPDFを可視化する。
                  ファイル名の表記ゆれで人物が別扱いになると必ずここに現れる。 */}
              {uncategorizedCount > 0 && (
                <button
                  onClick={() => handleToggleCategory(UNCATEGORIZED)}
                  className={`chip ${selectedCategories.includes(UNCATEGORIZED) ? "is-active" : ""}`}
                  title="カテゴリが設定されていないPDF。このままでは一括送信の対象になりません。"
                >
                  未分類
                  <span className="chip__count num">{uncategorizedCount}</span>
                </button>
              )}
              {selectedCategories.length >= 2 && (
                <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 4 }}>
                  選択順でソート
                </span>
              )}
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {matchGroups.length > 0 && (
                  <button
                    onClick={() => setShowMatchModal(true)}
                    className="btn btn--sm"
                    title="同一人物の可能性がある人物の候補を確認します"
                  >
                    要確認 <span className="num">{matchGroups.length}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowTokenModal(true)}
                  className="btn btn--sm btn--ghost"
                  title="ファイル名から取り除く書類名を設定します"
                >
                  ファイル名の設定
                </button>
              </span>
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
                              onClick={() => openEditPerson(person)}
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
                              onClick={() => openEditPerson(person)}
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
              {allCategories.length > 0 && (
                <>
                  <div className="field__label">既存カテゴリから選択</div>
                  <div className="toolbar" style={{ marginBottom: 12 }}>
                    {allCategories.map((c) => {
                      const isActive = editingCats.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleEditingCat(c)}
                          className={`chip ${isActive ? "is-active" : ""}`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="field__label">新しいカテゴリを追加</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input
                  type="text"
                  className="input"
                  value={catInput}
                  onChange={(e) => setCatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addNewCategoryFromInput();
                    }
                  }}
                  placeholder="名古屋, 大阪（カンマ区切りで複数可）"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={addNewCategoryFromInput}
                  className="btn"
                  disabled={!catInput.trim()}
                >
                  追加
                </button>
              </div>
              {editingCats.length > 0 && (
                <>
                  <div className="field__label">付与中のカテゴリ</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {editingCats.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleEditingCat(c)}
                        className="badge badge--blue"
                        style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
                        title="クリックで外す"
                      >
                        {c} <span style={{ opacity: 0.6 }}>×</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal__foot">
              <button onClick={() => setEditingPerson(null)} className="btn">キャンセル</button>
              <button onClick={handleSaveCategories} className="btn btn--primary">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 要確認（同一人物の候補）モーダル */}
      {showMatchModal && (
        <MatchModal
          groups={matchGroups}
          resolving={resolving}
          onResolve={resolveMatch}
          onClose={() => setShowMatchModal(false)}
        />
      )}

      {/* ファイル名の設定（書類名トークン辞書）モーダル */}
      {showTokenModal && (
        <TokenModal
          onClose={() => setShowTokenModal(false)}
          onChanged={fetchData}
        />
      )}

      {/* LINE送信モーダル */}
      {showSendModal && (
        <SendModal
          selected={selected}
          recipients={recipients}
          sending={sending}
          uncategorizedCount={selectedUncategorized}
          onSend={handleSend}
          onClose={() => setShowSendModal(false)}
          preselectRecipientIds={Array.from(
            new Set(
              selectedCategories.flatMap((c) => catRecipientMap[c] ?? [])
            )
          )}
        />
      )}
    </div>
  );
}

/**
 * 「要確認」モーダル。
 *
 * 取り込み時に既存人物へ寄せられなかった人物（＝カテゴリ未設定で残っている人物）に対し、
 * 同一人物かもしれない候補を出して人が確定する。ここで確定するまで
 * システムは絶対に別人物を勝手にまとめない（他人の給与明細を配信しないため）。
 */
function MatchModal({
  groups,
  resolving,
  onResolve,
  onClose,
}: {
  groups: MatchGroup[];
  resolving: boolean;
  onResolve: (action: "merge" | "separate", sourceId: string, targetId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">
            要確認 · <span className="num">{groups.length}</span>件
          </div>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0, lineHeight: 1.7 }}>
            ファイル名の書き方が違うために別人として登録された可能性がある人物です。
            <strong>同一人物</strong> にまとめると、その人物のPDF・カテゴリが統合され、
            次回以降は同じ書き方のファイルが自動で紐付きます。
            <strong>別人</strong> を選ぶと、以後この組み合わせは表示されません。
            <br />
            ※ 統合してもLINEに届くメッセージのタイトルは変わりません。
          </p>

          {groups.length === 0 ? (
            <div className="empty">確認が必要な人物はありません。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
              {groups.map((g) => (
                <div
                  key={g.person.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    padding: 10,
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {g.person.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>
                    カテゴリ未設定 — このままでは一括送信の対象になりません
                  </div>

                  {g.candidates.map((c) => (
                    <div
                      key={c.person.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        padding: "6px 0",
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      <span
                        className={`badge ${c.reason === "exact" ? "badge--blue" : "badge--purple"}`}
                        title={`類似度 ${Math.round(c.score * 100)}%`}
                      >
                        {REASON_LABEL[c.reason]}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{c.person.name}</span>
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {c.person.categories.length > 0 ? (
                          c.person.categories.map((cat) => (
                            <span key={cat} className="badge badge--blue">{cat}</span>
                          ))
                        ) : (
                          <span className="text-mute" style={{ fontSize: 11 }}>カテゴリなし</span>
                        )}
                      </span>
                      <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                        <button
                          className="btn btn--sm btn--primary"
                          disabled={resolving}
                          onClick={() => {
                            if (
                              confirm(
                                `「${g.person.name}」を「${c.person.name}」と同一人物としてまとめます。\n` +
                                  `「${g.person.name}」のPDFは「${c.person.name}」に移り、以後同じ書き方のファイルは自動で紐付きます。`,
                              )
                            ) {
                              onResolve("merge", g.person.id, c.person.id);
                            }
                          }}
                        >
                          同一人物
                        </button>
                        <button
                          className="btn btn--sm btn--ghost"
                          disabled={resolving}
                          onClick={() => onResolve("separate", g.person.id, c.person.id)}
                        >
                          別人
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn" disabled={resolving}>
            {resolving ? "処理中…" : "閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ファイル名の設定（書類名トークン辞書）モーダル。
 *
 * 「給与支払明細書_奥村華月.pdf」の「給与支払明細書」のように、
 * 氏名の前後に付く書類名をファイル名から取り除いて人物を同定するための辞書。
 * クライアントごとに付け方が違うので、コードを触らず画面から足せるようにしている。
 */
function TokenModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tokens, setTokens] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 再読み込みはカウンタを進めて effect を再実行させる。
  // effect の同期実行中に setState しない形（await の後だけで setState する）に
  // しておくのは react-hooks/set-state-in-effect のため。
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/v1/person-key-tokens");
      if (!alive) return;
      if (res.ok) {
        const d = await res.json();
        if (!alive) return;
        setTokens(d.tokens ?? []);
        setDefaults(d.defaults ?? []);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const add = async () => {
    const token = input.trim();
    if (!token) return;
    setBusy(true);
    const res = await fetch("/api/v1/person-key-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) alert(`エラー: ${(await res.json()).error ?? "不明"}`);
    setInput("");
    reload();
    setBusy(false);
    onChanged();
  };

  const remove = async (token: string) => {
    setBusy(true);
    await fetch(`/api/v1/person-key-tokens?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    reload();
    setBusy(false);
    onChanged();
  };

  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">ファイル名の設定</div>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0, lineHeight: 1.7 }}>
            ファイル名から取り除く<strong>書類名</strong>を登録します。
            例として「給与支払明細書」を登録すると
            <code>給与支払明細書_奥村華月.pdf</code> と <code>奥村華月.pdf</code> が
            同じ人物として扱われます。日付・連番・全角半角・区切り記号は登録なしで自動的に無視されます。
          </p>

          <div className="field__label">追加する書類名</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <input
              type="text"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="例: 〇〇株式会社"
              style={{ flex: 1 }}
              disabled={busy}
            />
            <button type="button" onClick={add} className="btn" disabled={busy || !input.trim()}>
              追加
            </button>
          </div>

          <div className="field__label">このシステムに登録済み</div>
          {loading ? (
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>読み込み中…</p>
          ) : tokens.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 12px" }}>
              まだありません（下の既定の書類名だけが使われます）
            </p>
          ) : (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {tokens.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => remove(t)}
                  className="badge badge--blue"
                  style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
                  title="クリックで削除"
                  disabled={busy}
                >
                  {t} <span style={{ opacity: 0.6 }}>×</span>
                </button>
              ))}
            </div>
          )}

          <div className="field__label">既定で取り除く書類名（変更不可）</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {defaults.map((t) => (
              <span key={t} className="badge" style={{ opacity: 0.7 }}>{t}</span>
            ))}
          </div>
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn" disabled={busy}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

function SendModal({
  selected,
  recipients,
  sending,
  uncategorizedCount,
  onSend,
  onClose,
  preselectRecipientIds,
}: {
  selected: Set<string>;
  recipients: Recipient[];
  sending: boolean;
  uncategorizedCount: number;
  onSend: (recipientIds: string[]) => void;
  onClose: () => void;
  preselectRecipientIds: string[];
}) {
  const availableIds = useMemo(() => new Set(recipients.map((r) => r.id)), [recipients]);
  const [chosenIds, setChosenIds] = useState<string[]>(() =>
    preselectRecipientIds.filter((id) => availableIds.has(id))
  );

  const toggle = (id: string) => {
    setChosenIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const selectAll = () => setChosenIds(recipients.map((r) => r.id));
  const clearAll = () => setChosenIds([]);

  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">LINE送信 · <span className="num">{selected.size}</span>件</div>
        </div>
        <div className="modal__body">
          {/* カテゴリ未設定のPDFは送信先がカテゴリ由来で決まらない。
              ファイル名の表記ゆれで人物が分かれているケースがここに出る。 */}
          {uncategorizedCount > 0 && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "8px 10px",
                marginBottom: 12,
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--text-2)",
                background: "var(--amber-soft, rgba(245, 158, 11, 0.10))",
                border: "1px solid var(--amber-border, rgba(245, 158, 11, 0.35))",
                borderRadius: 5,
              }}
            >
              <span aria-hidden>⚠️</span>
              <span>
                選択中のうち <span className="num">{uncategorizedCount}</span> 件はカテゴリ未設定です。
                ファイル名の表記ゆれで人物が別扱いになっている可能性があります。
                「要確認」で同一人物にまとめるか、カテゴリを設定してから送信してください。
              </span>
            </div>
          )}
          <div className="field__label" style={{ marginBottom: 8 }}>
            送信先（複数選択可）
            <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-3)" }}>
              {chosenIds.length} / {recipients.length} 件選択中
            </span>
          </div>
          {recipients.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-2)", margin: 0 }}>
              有効な送信先がありません。Botにメッセージを送ってもらうと自動登録されます。
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button type="button" onClick={selectAll} className="btn btn--sm btn--ghost">すべて選択</button>
                <button type="button" onClick={clearAll} className="btn btn--sm btn--ghost" disabled={chosenIds.length === 0}>クリア</button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 4,
                  maxHeight: 280,
                  overflowY: "auto",
                  padding: 6,
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: "var(--surface)",
                }}
              >
                {recipients.map((r) => {
                  const isSel = chosenIds.includes(r.id);
                  const isGroup = (r as Record<string, unknown>).type === "group";
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-pressed={isSel}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 9px",
                        fontSize: 12,
                        fontWeight: 500,
                        color: isSel ? "var(--blue-2)" : "var(--text-2)",
                        background: isSel ? "var(--blue-soft)" : "var(--surface)",
                        border: `1px solid ${isSel ? "var(--blue-border)" : "var(--border)"}`,
                        borderRadius: 5,
                        cursor: "pointer",
                        textAlign: "left",
                        minWidth: 0,
                        fontFamily: "inherit",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          border: "1px solid var(--border-strong)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 700,
                          color: isSel ? "#fff" : "transparent",
                          background: isSel ? "var(--blue)" : "var(--surface)",
                          borderColor: isSel ? "var(--blue)" : "var(--border-strong)",
                          flexShrink: 0,
                        }}
                      >
                        {isSel ? "✓" : ""}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.displayName}
                      </span>
                      {isGroup && <span className="badge badge--purple" style={{ marginLeft: "auto" }}>G</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn" disabled={sending}>キャンセル</button>
          <button
            onClick={() => {
              if (chosenIds.length === 0) { alert("送信先を選択してください"); return; }
              if (confirm(`${chosenIds.length}件の宛先に PDF ${selected.size}件を LINE 送信しますか？`)) {
                onSend(chosenIds);
              }
            }}
            disabled={sending || chosenIds.length === 0}
            className="btn btn--primary"
          >
            {sending ? "送信中…" : `送信 (${chosenIds.length}件)`}
          </button>
        </div>
      </div>
    </div>
  );
}
