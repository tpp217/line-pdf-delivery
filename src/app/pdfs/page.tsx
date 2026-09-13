"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  formatUploadPeriod,
  toUploadPeriod,
  uploadPeriodOptions,
} from "@/lib/upload-period";

type PdfDocument = {
  id: string;
  originalFileName: string;
  fileSizeBytes: number;
  personName: string | null;
  personId: string | null;
  uploadedAt: string;
  /** 「〇月アップ分」タグ（YYYY-MM）。分類はこれが正。 */
  upload_period: string | null;
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

type MatchPerson = {
  id: string;
  name: string;
  categories: string[];
  /** 正規化キー。統合先の既定を決めるのに使う。 */
  key: string;
  /** クラスタの代表キーとの関係。 */
  reason: MatchReason;
  score: number;
};

/** 同一人物かもしれない人物の塊。人物ごとではなく塊ごとに 1 件。 */
type MatchCluster = {
  id: string;
  members: MatchPerson[];
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

// 分類は「〇月アップ分」タグ（upload_period）で行う。実際のアップロード日時では分類しない
// ―― 過去分の差し替えを後から上げることがあり、実日付だとひと月ずれるため。
// タグ未設定の古い行だけ、実アップロード日（JST）から補って表示する。
function periodOf(p: PdfDocument): string {
  return p.upload_period ?? toUploadPeriod(new Date(p.uploadedAt));
}
function toYear(p: PdfDocument) { return periodOf(p).slice(0, 4); }
function toMonth(p: PdfDocument) { return periodOf(p).slice(5, 7); }

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
  const [matchClusters, setMatchClusters] = useState<MatchCluster[]>([]);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [resolving, setResolving] = useState(false);
  // アップロードは「〇月アップ分」を確定してから実行する。既定は今月（JST）だが、
  // 過去分の差し替えを上げることがあるので必ず人に確認させる。
  const [pendingUpload, setPendingUpload] = useState<{ files: File[]; folderName?: string } | null>(null);
  const [pendingPeriod, setPendingPeriod] = useState<string>(() => toUploadPeriod());
  const [retagOpen, setRetagOpen] = useState(false);
  const [retagging, setRetagging] = useState(false);
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
    setMatchClusters((mData.items ?? []) as MatchCluster[]);
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

  // データ上に存在する期間。選択肢の範囲外でも選べるようにする。
  const existingPeriods = useMemo(
    () => Array.from(new Set(allPdfs.map((p) => periodOf(p)))).sort().reverse(),
    [allPdfs],
  );

  const years = useMemo(() => {
    const s = new Set<string>();
    allPdfs.forEach((p) => s.add(toYear(p)));
    return Array.from(s).sort().reverse();
  }, [allPdfs]);

  const yearPdfs = useMemo(() => {
    if (selectedYear === "all") return allPdfs;
    return allPdfs.filter((p) => toYear(p) === selectedYear);
  }, [allPdfs, selectedYear]);

  const months = useMemo(() => {
    const s = new Set<string>();
    yearPdfs.forEach((p) => s.add(toMonth(p)));
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
        : yearPdfs.filter((p) => toMonth(p) === selectedMonth),
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

  const uploadFiles = useCallback(async (files: File[], folderName: string | undefined, period: string) => {
    if (files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    formData.append("sourceFolderName", folderName || "ブラウザアップロード");
    formData.append("uploadPeriod", period);
    try {
      const res = await fetch("/api/v1/uploads/folder", { method: "POST", body: formData });
      if (res.ok) {
        const r = await res.json();
        const reused = (r.matchedByName ?? 0) + (r.matchedByAlias ?? 0);
        const skipped = r.skippedDuplicates ?? 0;
        alert(
          [
            r.acceptedFiles > 0
              ? `${formatUploadPeriod(r.uploadPeriod ?? period)}アップ分として${r.acceptedFiles}件のPDFを登録しました`
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

  // ファイルを受け取ったら即アップロードせず、「〇月アップ分」を確定させてから実行する。
  const requestUpload = (files: File[], folderName?: string) => {
    if (files.length === 0) return;
    setPendingPeriod(toUploadPeriod());
    setPendingUpload({ files, folderName });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    requestUpload(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;
    const allFiles: File[] = [];
    const entries = Array.from(items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    for (const entry of entries) await readAllEntries(entry, allFiles);
    if (allFiles.length === 0) { requestUpload(Array.from(e.dataTransfer.files)); return; }
    requestUpload(allFiles, entries.find((e) => e.isDirectory)?.name);
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

  // 「要確認」のまとめて確定。merge = 同一人物として統合、separate = 別人として以後出さない。
  // 保留は指示に含めない（サーバー側に何も記録せず、次回もそのまま候補に出る）。
  // 統合しても pdf_documents.personName は書き換えないので、LINE に届く文面は変わらない。
  const applyMatches = async (
    actions: { action: "merge" | "separate"; sourceId: string; targetId: string }[],
  ) => {
    if (actions.length === 0) return;
    setResolving(true);
    try {
      const res = await fetch("/api/v1/persons/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        alert(`エラー: ${r.error ?? "不明"}`);
        return;
      }
      await fetchData();
      // 207 は一部失敗。何が残ったか分かるように理由まで出す。
      const failed = (r.results ?? []).filter(
        (x: { status: string }) => x.status === "failed",
      );
      alert(
        [
          `統合 ${r.merged ?? 0}件 / 別人 ${r.separated ?? 0}件を確定しました`,
          r.skipped ? `${r.skipped}件は先の統合で解決済みのため飛ばしました` : null,
          failed.length > 0
            ? `${failed.length}件は失敗しました:\n${failed
                .map((x: { reason?: string }) => `・${x.reason ?? "不明"}`)
                .join("\n")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (failed.length === 0) setShowMatchModal(false);
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    } finally {
      setResolving(false);
    }
  };

  // 「〇月アップ分」の付け替え。選び間違いや、過去分をそのまま上げてしまった場合に使う。
  const retagSelected = async (period: string) => {
    setRetagging(true);
    try {
      const res = await fetch("/api/v1/pdfs/period", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), uploadPeriod: period }),
      });
      if (!res.ok) {
        alert(`エラー: ${(await res.json()).error ?? "不明"}`);
        return;
      }
      const r = await res.json();
      setRetagOpen(false);
      setSelected(new Set());
      await fetchData();
      alert(`${r.updated}件を${formatUploadPeriod(period)}アップ分に変更しました`);
    } catch (e) {
      alert(`通信エラー: ${e instanceof Error ? e.message : "不明"}`);
    } finally {
      setRetagging(false);
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
          <br />
          <span style={{ color: "var(--text-3)" }}>
            登録前に「〇月アップ分」を確認します（既定: {formatUploadPeriod(toUploadPeriod())}）
          </span>
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
                <span className="chip__count num">{allPdfs.filter((p) => toYear(p) === y).length}</span>
              </button>
            ))}
          </div>

          {/* 月タブ */}
          {selectedYear !== "all" && selectedYear !== "" && (
            <div className="toolbar" style={{ marginBottom: 6 }}>
              <span className="toolbar__label" title="アップロードした実日時ではなく、登録時に選んだタグで分類しています">
                アップ分
              </span>
              <button onClick={() => setSelectedMonth("all")} className={`chip ${selectedMonth === "all" ? "is-active" : ""}`}>
                すべて <span className="chip__count num">{yearPdfs.length}</span>
              </button>
              {months.map((m) => (
                <button key={m} onClick={() => setSelectedMonth(m)} className={`chip ${selectedMonth === m ? "is-active" : ""}`}>
                  <span className="num">{parseInt(m)}</span>月
                  <span className="chip__count num">{yearPdfs.filter((p) => toMonth(p) === m).length}</span>
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
                {matchClusters.length > 0 && (
                  <button
                    onClick={() => setShowMatchModal(true)}
                    className="btn btn--sm"
                    title="同一人物の可能性がある人物の候補を確認します"
                  >
                    要確認 <span className="num">{matchClusters.length}</span>
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
                <button onClick={() => setRetagOpen(true)} className="btn">
                  アップ分を変更
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

      {/* アップ分の確認（アップロード前） */}
      {pendingUpload && (
        <PeriodModal
          title="アップ分の確認"
          confirmLabel={uploading ? "登録中…" : `${pendingUpload.files.length}件を登録`}
          busy={uploading}
          value={pendingPeriod}
          options={uploadPeriodOptions(toUploadPeriod(), existingPeriods)}
          onChange={setPendingPeriod}
          onClose={() => setPendingUpload(null)}
          onConfirm={async () => {
            const target = pendingUpload;
            setPendingUpload(null);
            await uploadFiles(target.files, target.folderName, pendingPeriod);
          }}
        >
          <>
            選択した <span className="num">{pendingUpload.files.length}</span> 件を
            <strong>「{formatUploadPeriod(pendingPeriod)}アップ分」</strong>として登録します。
            <br />
            過去分の差し替えを登録する場合は、その月に変更してください。
            実際のアップロード日時ではなく、ここで選んだタグで分類されます。
          </>
        </PeriodModal>
      )}

      {/* アップ分の付け替え（登録済みPDF） */}
      {retagOpen && (
        <PeriodModal
          title="アップ分を変更"
          confirmLabel={retagging ? "変更中…" : `${selected.size}件を変更`}
          busy={retagging}
          value={pendingPeriod}
          options={uploadPeriodOptions(toUploadPeriod(), existingPeriods)}
          onChange={setPendingPeriod}
          onClose={() => setRetagOpen(false)}
          onConfirm={() => retagSelected(pendingPeriod)}
        >
          <>
            選択中の <span className="num">{selected.size}</span> 件を
            <strong>「{formatUploadPeriod(pendingPeriod)}アップ分」</strong>に変更します。
            <br />
            PDF の中身や配信履歴には影響しません。分類（年／アップ分タブ）だけが変わります。
          </>
        </PeriodModal>
      )}

      {/* 要確認（同一人物の候補）モーダル */}
      {showMatchModal && (
        <MatchModal
          clusters={matchClusters}
          resolving={resolving}
          onApply={applyMatches}
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
 * 「〇月アップ分」タグを選ぶ共通モーダル。
 * 登録前の確認と、登録済みPDFの付け替えの両方で使う。
 */
function PeriodModal({
  title,
  confirmLabel,
  busy,
  value,
  options,
  onChange,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal__backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">{title}</div>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0, lineHeight: 1.7 }}>
            {children}
          </p>
          <div className="field__label">アップ分</div>
          <select
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            style={{ width: "100%" }}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {formatUploadPeriod(o)}アップ分
              </option>
            ))}
          </select>
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn" disabled={busy}>キャンセル</button>
          <button onClick={onConfirm} className="btn btn--primary" disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 要確認の 1 クラスタに対する判断。
 *
 * memberIds は「同じ人物だとチェックした人物」。実データでは
 * 「奥村 / 奥村華月 / 給与支払明細書_奥村華月」のように 3 件以上が同一人物という
 * ケースが大半なので、複数選べる必要がある。保留はサーバーに何も送らない。
 */
type MatchDecision =
  | { kind: "same"; memberIds: string[]; survivorId?: string }
  | { kind: "different" }
  | { kind: "hold" };

/**
 * 統合先（生き残る人物）の既定を決める。
 *
 * カテゴリは見ない。統合時に和集合で寄せる（src/lib/person-merge.ts）ので、
 * どれを残してもカテゴリは失われず、選定の判断材料にならないため。
 * PDF の紐付けも配信タイトル（pdf_documents.personName を使う）も統合先で変わらない。
 * つまりここで決まるのは実質「アプリ内でその人を指す名前」なので、名前の質だけで選ぶ。
 *
 *   1. 正規化キーが長いもの＝より完全な氏名（「奥村」より「奥村華月」）
 *   2. キーとの差が小さいもの＝書類名の蛇足が少ない
 *      （「給与支払明細書_原ヂエゴガルキス」より「原ヂエゴガルキス」）
 *   3. 短いもの / id 順（安定した順序のため）
 */
function pickSurvivor(members: MatchPerson[]): MatchPerson {
  return [...members].sort((a, b) => {
    if (a.key.length !== b.key.length) return b.key.length - a.key.length;
    const aExtra = a.name.length - a.key.length;
    const bExtra = b.name.length - b.key.length;
    if (aExtra !== bExtra) return aExtra - bExtra;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.id < b.id ? -1 : 1;
  })[0];
}

/**
 * 「要確認」モーダル。
 *
 * 同一人物かもしれない人物の「塊」を 1 件ずつ出し、その中で同じ人物にチェックを
 * 入れてもらう。塊単位なので、同じ顔ぶれが何度も並ぶことはない。
 *
 * 確定するまでシステムは絶対に別人物を勝手にまとめない（他人の給与明細を
 * 配信しないため）。件数が多いので、まとめて確定できるようにしている。
 */
function MatchModal({
  clusters,
  resolving,
  onApply,
  onClose,
}: {
  clusters: MatchCluster[];
  resolving: boolean;
  onApply: (actions: { action: "merge" | "separate"; sourceId: string; targetId: string }[]) => void;
  onClose: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, MatchDecision>>({});

  const toggleMember = (clusterId: string, memberId: string) => {
    setDecisions((prev) => {
      const cur = prev[clusterId];
      const checked = cur?.kind === "same" ? cur.memberIds : [];
      const next = checked.includes(memberId)
        ? checked.filter((x) => x !== memberId)
        : [...checked, memberId];
      const copy = { ...prev };
      if (next.length === 0) {
        delete copy[clusterId];
      } else {
        // 統合先に指定していた人物のチェックを外したら、既定に戻す。
        const survivorId =
          cur?.kind === "same" && cur.survivorId && next.includes(cur.survivorId)
            ? cur.survivorId
            : undefined;
        copy[clusterId] = { kind: "same", memberIds: next, survivorId };
      }
      return copy;
    });
  };

  const chooseSurvivor = (clusterId: string, survivorId: string) => {
    setDecisions((prev) => {
      const cur = prev[clusterId];
      if (cur?.kind !== "same") return prev;
      return { ...prev, [clusterId]: { ...cur, survivorId } };
    });
  };

  const toggleKind = (clusterId: string, kind: "different" | "hold") => {
    setDecisions((prev) => {
      const copy = { ...prev };
      if (copy[clusterId]?.kind === kind) delete copy[clusterId];
      else copy[clusterId] = { kind };
      return copy;
    });
  };

  // 完全一致は正規化後の文字列が同じなので、まとめて選んでも取り違えようがない。
  const selectAllExact = () => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const c of clusters) {
        if (next[c.id]) continue;
        const exact = c.members.filter((m) => m.reason === "exact").map((m) => m.id);
        if (exact.length >= 2) next[c.id] = { kind: "same", memberIds: exact };
      }
      return next;
    });
  };

  const checkedOf = (c: MatchCluster, d: MatchDecision | undefined): MatchPerson[] =>
    d?.kind === "same" ? c.members.filter((m) => d.memberIds.includes(m.id)) : [];

  const counts = useMemo(() => {
    let same = 0, samePeople = 0, different = 0, hold = 0;
    for (const c of clusters) {
      const d = decisions[c.id];
      if (d?.kind === "same") { same++; samePeople += d.memberIds.length; }
      else if (d?.kind === "different") different++;
      else if (d?.kind === "hold") hold++;
    }
    return { same, samePeople, different, hold, undecided: clusters.length - same - different - hold };
  }, [clusters, decisions]);

  const exactAvailable = useMemo(
    () =>
      clusters.filter(
        (c) => !decisions[c.id] && c.members.filter((m) => m.reason === "exact").length >= 2,
      ).length,
    [clusters, decisions],
  );

  const buildActions = () => {
    const actions: { action: "merge" | "separate"; sourceId: string; targetId: string }[] = [];
    for (const c of clusters) {
      const d = decisions[c.id];
      if (!d || d.kind === "hold") continue;
      if (d.kind === "same") {
        const checked = checkedOf(c, d);
        if (checked.length < 2) continue; // 1 人だけのチェックは統合にならない
        const survivor = checked.find((m) => m.id === d.survivorId) ?? pickSurvivor(checked);
        for (const m of checked) {
          if (m.id !== survivor.id) {
            actions.push({ action: "merge", sourceId: m.id, targetId: survivor.id });
          }
        }
      } else {
        // 「どれも別人」は塊の中の全ペアを却下する（塊が再結成しないように）。
        for (let i = 0; i < c.members.length; i++) {
          for (let j = i + 1; j < c.members.length; j++) {
            actions.push({
              action: "separate",
              sourceId: c.members[i].id,
              targetId: c.members[j].id,
            });
          }
        }
      }
    }
    return actions;
  };

  const pending = counts.same + counts.different;

  return (
    <div className="modal__backdrop" onClick={resolving ? undefined : onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div className="modal__title">
            要確認 · <span className="num">{clusters.length}</span>件
          </div>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0, lineHeight: 1.7 }}>
            ファイル名の書き方が違うために別人として登録された可能性がある人物の
            かたまりです。<strong>同じ人物にチェックを入れてください（複数可）</strong>。
            チェックした人物はまとめて 1 人に統合され、PDF とカテゴリが引き継がれます
            （カテゴリは全員分の和集合なので、どれを残しても失われません）。
            該当が無ければ <strong>どれも別人</strong>、後で決めるなら <strong>保留</strong>
            （何も記録せず次回もここに出ます）。
            <br />
            ※ 統合してもLINEに届くメッセージのタイトルは変わりません。
          </p>

          {clusters.length === 0 ? (
            <div className="empty">確認が必要な人物はありません。</div>
          ) : (
            <>
              <div className="toolbar" style={{ marginBottom: 10, gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={selectAllExact}
                  disabled={resolving || exactAvailable === 0}
                  title="正規化後の名前が完全に一致しているものだけをチェックします"
                >
                  完全一致をすべてチェック（{exactAvailable}）
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setDecisions({})}
                  disabled={resolving || Object.keys(decisions).length === 0}
                >
                  選択をクリア
                </button>
                <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                  同一 <span className="num">{counts.same}</span>組 ／ 別人{" "}
                  <span className="num">{counts.different}</span> ／ 保留{" "}
                  <span className="num">{counts.hold}</span> ／ 未選択{" "}
                  <span className="num">{counts.undecided}</span>
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
                {clusters.map((c) => {
                  const d = decisions[c.id];
                  const checked = checkedOf(c, d);
                  const survivorId = d?.kind === "same" ? d.survivorId : undefined;
                  const survivor =
                    checked.length >= 2
                      ? checked.find((m) => m.id === survivorId) ?? pickSurvivor(checked)
                      : null;
                  return (
                    <div
                      key={c.id}
                      style={{
                        border: `1px solid ${d ? "var(--blue-border)" : "var(--border)"}`,
                        borderRadius: 5,
                        padding: 10,
                        background: "var(--surface)",
                        opacity: d?.kind === "hold" ? 0.55 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          同じ人物にチェック（<span className="num">{c.members.length}</span>人・複数可）
                        </span>
                        <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                          <button
                            type="button"
                            className={`chip ${d?.kind === "different" ? "is-active" : ""}`}
                            onClick={() => toggleKind(c.id, "different")}
                            disabled={resolving}
                          >
                            どれも別人
                          </button>
                          <button
                            type="button"
                            className={`chip ${d?.kind === "hold" ? "is-active" : ""}`}
                            onClick={() => toggleKind(c.id, "hold")}
                            disabled={resolving}
                          >
                            保留
                          </button>
                        </span>
                      </div>

                      {c.members.map((m) => {
                        const isChecked = d?.kind === "same" && d.memberIds.includes(m.id);
                        return (
                          <label
                            key={m.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                              padding: "6px 0",
                              borderTop: "1px solid var(--border)",
                              cursor: resolving ? "default" : "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleMember(c.id, m.id)}
                              disabled={resolving}
                            />
                            <span
                              className={`badge ${m.reason === "exact" ? "badge--blue" : "badge--purple"}`}
                              title={`類似度 ${Math.round(m.score * 100)}%`}
                            >
                              {REASON_LABEL[m.reason]}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {m.categories.length > 0 ? (
                                m.categories.map((cat) => (
                                  <span key={cat} className="badge badge--blue">{cat}</span>
                                ))
                              ) : (
                                <span className="text-mute" style={{ fontSize: 11 }}>カテゴリなし</span>
                              )}
                            </span>
                            {isChecked && survivor && (
                              <span style={{ marginLeft: "auto" }}>
                                {survivor.id === m.id ? (
                                  <span className="badge badge--blue">統合先</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--ghost"
                                    onClick={(e) => {
                                      // label の中なのでチェックのトグルまで伝播させない
                                      e.preventDefault();
                                      e.stopPropagation();
                                      chooseSurvivor(c.id, m.id);
                                    }}
                                    disabled={resolving}
                                    title="この名前を残します"
                                  >
                                    統合先にする
                                  </button>
                                )}
                              </span>
                            )}
                          </label>
                        );
                      })}

                      {survivor && (
                        <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 8 }}>
                          <span className="num">{checked.length}</span>人を
                          <strong>「{survivor.name}」</strong>にまとめます
                          <span style={{ color: "var(--text-3)" }}>
                            {" "}— 残す名前は「統合先にする」で変更できます
                          </span>
                        </div>
                      )}
                      {d?.kind === "same" && checked.length === 1 && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
                          統合するには 2 人以上チェックしてください
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="modal__foot">
          <button onClick={onClose} className="btn" disabled={resolving}>
            {resolving ? "処理中…" : "閉じる"}
          </button>
          <button
            className="btn btn--primary"
            disabled={resolving || buildActions().length === 0}
            onClick={() => {
              const actions = buildActions();
              const parts = [
                counts.same > 0
                  ? `同一 ${counts.same}組（${counts.samePeople}人を統合します）`
                  : null,
                counts.different > 0 ? `別人 ${counts.different}組` : null,
              ].filter(Boolean).join("\n");
              if (confirm(`次の内容で確定します。\n\n${parts}\n\nよろしいですか？`)) {
                onApply(actions);
              }
            }}
          >
            {resolving ? "確定中…" : `確定 (${pending})`}
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
