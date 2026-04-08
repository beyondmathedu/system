"use client";

import { useEffect, useMemo, useState } from "react";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { supabase } from "@/lib/supabase";

type TeacherStatus = "工作中" | "放假中" | "已解僱";
const TEACHER_STATUS_OPTIONS: TeacherStatus[] = ["工作中", "放假中", "已解僱"];
const TEACHER_STATUS_DISPLAY: Record<TeacherStatus, string> = {
  "工作中": "Active",
  "放假中": "Occasional",
  "已解僱": "Inactive",
};

/** Active → Occasional → Inactive（與 TEACHER_STATUS_OPTIONS 順序一致） */
function compareTeacherStatusRank(a: TeacherStatus, b: TeacherStatus): number {
  return TEACHER_STATUS_OPTIONS.indexOf(a) - TEACHER_STATUS_OPTIONS.indexOf(b);
}

const DEFAULT_TUTOR_COLOR = "#1d76c2";

type Teacher = {
  id: string;
  /** 列表排序／搜尋用主名稱：中文優先，否則英文 */
  name: string;
  nameZh: string;
  nameEn: string;
  status: TeacherStatus;
  colorHex: string;
};

type TeacherRow = {
  id: string;
  name?: string;
  name_zh?: string;
  name_en?: string;
  status?: string;
  color_hex?: string | null;
};

type TeacherRateRow = {
  tutor_id: string;
  junior_rate: number;
  senior_rate: number;
  single_student_rate: number;
};

type SortDirection = "asc" | "desc";
type TeacherSortKey = "id" | "name" | "nameEn" | "junior" | "senior" | "single" | "status";
type TeacherSortConfig = { key: TeacherSortKey; direction: SortDirection } | null;

function getTeacherStatusBadgeClass(status: TeacherStatus) {
  switch (status) {
    case "工作中":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "放假中":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "已解僱":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getNextTeacherId(teachers: Teacher[]) {
  const maxNumber = teachers.reduce((max, teacher) => {
    const match = /^T(\d+)$/i.exec(teacher.id.trim());
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return `T${String(maxNumber + 1).padStart(3, "0")}`;
}

function getNextTeacherIdFromTextId(idText: string | null | undefined) {
  if (!idText) return "T001";
  const match = /^T(\d+)$/i.exec(idText.trim());
  if (!match) return "T001";
  return `T${String(Number(match[1]) + 1).padStart(3, "0")}`;
}

function formatRateDisplay(value: number): string {
  return `$${value}`;
}

function normalizeHexColor(input: string): string | null {
  const s = input.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function resolveTutorColorHex(raw: string | null | undefined): string {
  const n = normalizeHexColor((raw ?? "").trim());
  return n ?? DEFAULT_TUTOR_COLOR;
}

function mapRowToTeacher(row: TeacherRow): Teacher {
  const status = (row.status ?? "工作中").trim();
  const zh = (row.name_zh ?? "").trim();
  const en = (row.name_en ?? "").trim();
  const nm = (row.name ?? "").trim();
  const nameZh = zh || (!en && nm ? nm : zh);
  const nameEn = en;
  const primary = nameZh || nameEn || nm;
  return {
    id: row.id,
    name: primary,
    nameZh,
    nameEn,
    status: TEACHER_STATUS_OPTIONS.includes(status as TeacherStatus)
      ? (status as TeacherStatus)
      : "工作中",
    colorHex: (row.color_hex ?? "").trim(),
  };
}

export default function TeacherPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [query, setQuery] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherNameEn, setTeacherNameEn] = useState("");
  const [teacherStatus, setTeacherStatus] = useState<TeacherStatus>("工作中");
  const [tutorColorHex, setTutorColorHex] = useState(DEFAULT_TUTOR_COLOR);
  const [hexTextDraft, setHexTextDraft] = useState(DEFAULT_TUTOR_COLOR);
  const [rateJunior, setRateJunior] = useState("");
  const [rateSenior, setRateSenior] = useState("");
  const [rateSingle, setRateSingle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [dataError, setDataError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [rateByTeacherId, setRateByTeacherId] = useState<Record<string, { junior: number; senior: number; single: number }>>({});
  const [sortConfig, setSortConfig] = useState<TeacherSortConfig>(null);

  const filteredTeachers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return teachers;
    return teachers.filter(
      (t) =>
        t.id.toLowerCase().includes(keyword) ||
        t.name.toLowerCase().includes(keyword) ||
        t.nameZh.toLowerCase().includes(keyword) ||
        t.nameEn.toLowerCase().includes(keyword),
    );
  }, [query, teachers]);

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);

  const nextTeacherId = useMemo(() => getNextTeacherId(teachers), [teachers]);
  const firstFilteredTeacherId = filteredTeachers[0]?.id;
  const sortedTeachers = useMemo(() => {
    const rows = filteredTeachers.map((t) => ({
      ...t,
      junior: rateByTeacherId[t.id]?.junior ?? 0,
      senior: rateByTeacherId[t.id]?.senior ?? 0,
      single: rateByTeacherId[t.id]?.single ?? 0,
    }));
    if (!sortConfig) {
      rows.sort((a, b) => {
        const byStatus = compareTeacherStatusRank(a.status, b.status);
        if (byStatus !== 0) return byStatus;
        return a.id.localeCompare(b.id);
      });
      return rows;
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "id":
          cmp = a.id.localeCompare(b.id);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "nameEn":
          cmp = a.nameEn.localeCompare(b.nameEn, "en", { sensitivity: "base", numeric: true });
          break;
        case "junior":
          cmp = a.junior - b.junior;
          break;
        case "senior":
          cmp = a.senior - b.senior;
          break;
        case "single":
          cmp = a.single - b.single;
          break;
        case "status":
          cmp = compareTeacherStatusRank(a.status, b.status);
          break;
        default:
          return 0;
      }
      cmp *= multiplier;
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [filteredTeachers, rateByTeacherId, sortConfig]);

  async function loadTeachers() {
    setDataError("");
    const { data, error } = await supabase
      .from("tutors")
      .select("id, name, name_zh, name_en, status, color_hex")
      .order("id");
    if (error) {
      setDataError(error.message);
      return;
    }
    setTeachers((data ?? []).map(mapRowToTeacher));
  }

  async function loadLatestRates() {
    const { data, error } = await supabase
      .from("latest_tutor_rates")
      .select("tutor_id, junior_rate, senior_rate, single_student_rate");
    if (error) return;

    const map: Record<string, { junior: number; senior: number; single: number }> = {};
    for (const row of (data ?? []) as TeacherRateRow[]) {
      if (map[row.tutor_id]) continue;
      map[row.tutor_id] = {
        junior: Number(row.junior_rate),
        senior: Number(row.senior_rate),
        single: Number(row.single_student_rate),
      };
    }
    setRateByTeacherId(map);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      await Promise.all([loadTeachers(), loadLatestRates()]);
      if (mounted) setIsLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function resetForm() {
    setEditingId(null);
    setTeacherName("");
    setTeacherNameEn("");
    setTeacherStatus("工作中");
    setTutorColorHex(DEFAULT_TUTOR_COLOR);
    setHexTextDraft(DEFAULT_TUTOR_COLOR);
    setRateJunior("");
    setRateSenior("");
    setRateSingle("");
    setFormError("");
  }

  function parseRates() {
    const junior = Number(rateJunior);
    const senior = Number(rateSenior);
    const single = Number(rateSingle);
    if (
      Number.isNaN(junior) ||
      Number.isNaN(senior) ||
      Number.isNaN(single) ||
      junior < 0 ||
      senior < 0 ||
      single < 0
    ) {
      return { ok: false as const, message: "請輸入有效價錢（不可小於 0）。" };
    }
    return { ok: true as const, junior, senior, single };
  }

  async function onSubmitTeacher() {
    const nameZh = teacherName.trim();
    const nameEn = teacherNameEn.trim();
    if (!nameZh && !nameEn) {
      setFormError("請輸入中文姓名或英文全名至少一項。");
      return;
    }
    const name = nameEn || nameZh;

    const rateParsed = parseRates();
    if (!rateParsed.ok) {
      setFormError(rateParsed.message);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setFormError("");
    setIsSaving(true);

    if (editingId) {
      const { error: updateErr } = await supabase
        .from("tutors")
        .update({
          name,
          name_zh: nameZh,
          name_en: nameEn,
          status: teacherStatus,
          color_hex: tutorColorHex,
        })
        .eq("id", editingId);

      if (updateErr) {
        setIsSaving(false);
        setFormError(`儲存失敗：${updateErr.message}`);
        return;
      }

      const { error: rateErr } = await supabase.from("tutor_rates").insert([
        {
          tutor_id: editingId,
          tutor_name: name,
          junior_rate: rateParsed.junior,
          senior_rate: rateParsed.senior,
          single_student_rate: rateParsed.single,
          effective_date: today,
        },
      ]);

      setIsSaving(false);
      if (rateErr) {
        setFormError(`老師已更新，但價錢新增失敗：${rateErr.message}`);
        await Promise.all([loadTeachers(), loadLatestRates()]);
        return;
      }

      resetForm();
      await Promise.all([loadTeachers(), loadLatestRates()]);
      return;
    }

    let insertedTeacherId = "";
    let lastErrorMessage = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: latestRow, error: latestErr } = await supabase
        .from("tutors")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestErr) {
        lastErrorMessage = latestErr.message;
        break;
      }

      const newId = getNextTeacherIdFromTextId(latestRow?.id);
      const { error: insertErr } = await supabase
        .from("tutors")
        .insert([
          { id: newId, name, name_zh: nameZh, name_en: nameEn, status: teacherStatus, color_hex: tutorColorHex },
        ]);

      if (!insertErr) {
        insertedTeacherId = newId;
        break;
      }

      if (insertErr.message.toLowerCase().includes("duplicate key value")) {
        lastErrorMessage = insertErr.message;
        continue;
      }
      lastErrorMessage = insertErr.message;
      break;
    }

    if (!insertedTeacherId) {
      setIsSaving(false);
      setFormError(`新增失敗：${lastErrorMessage || "請稍後再試"}`);
      return;
    }

    const { error: rateErr } = await supabase.from("tutor_rates").insert([
      {
        tutor_id: insertedTeacherId,
        tutor_name: name,
        junior_rate: rateParsed.junior,
        senior_rate: rateParsed.senior,
        single_student_rate: rateParsed.single,
        effective_date: today,
      },
    ]);

    if (rateErr) {
      await supabase.from("tutors").delete().eq("id", insertedTeacherId);
      setIsSaving(false);
      setFormError(`新增失敗：價錢寫入失敗（已回復老師資料）- ${rateErr.message}`);
      return;
    }

    setIsSaving(false);
    resetForm();
    await Promise.all([loadTeachers(), loadLatestRates()]);
  }

  function startEditSelected() {
    if (selectedIds.length !== 1) {
      setSelectionError("請先只選取 1 位老師再按編輯。");
      return;
    }
    const target = teacherById.get(selectedIds[0]);
    if (!target) return;
    setSelectionError("");
    setEditingId(target.id);
    setTeacherName(target.nameZh);
    setTeacherNameEn(target.nameEn);
    setTeacherStatus(target.status);
    const hex = resolveTutorColorHex(target.colorHex);
    setTutorColorHex(hex);
    setHexTextDraft(hex);
    const rates = rateByTeacherId[target.id];
    if (rates) {
      setRateJunior(String(rates.junior));
      setRateSenior(String(rates.senior));
      setRateSingle(String(rates.single));
    } else {
      setRateJunior("");
      setRateSenior("");
      setRateSingle("");
    }
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) {
      setSelectionError("請先勾選要刪除的老師。");
      return;
    }
    const { error } = await supabase.from("tutors").delete().in("id", selectedIds);
    if (error) {
      setSelectionError(`刪除失敗：${error.message}`);
      return;
    }
    setSelectionError("");
    setSelectedIds([]);
    if (editingId && selectedIds.includes(editingId)) resetForm();
    await Promise.all([loadTeachers(), loadLatestRates()]);
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="reports" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Tutor 資料</h1>
            <p className="mt-1 text-sm text-blue-100">老師ID 自動編號：T001 起。新增導師時同步建立 Tutor Rates。</p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr_1fr_1fr_1fr_1fr_200px_160px_auto] md:items-end">
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-700">老師ID</p>
                <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                  {editingId ?? nextTeacherId}
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">老師姓名</span>
                <input
                  type="text"
                  value={teacherName}
                  onChange={(event) => setTeacherName(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  placeholder="例如：王小明"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">英文全名</span>
                <input
                  type="text"
                  value={teacherNameEn}
                  onChange={(event) => setTeacherNameEn(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  placeholder="e.g. Samuel Chan"
                  autoComplete="name"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">初中價</span>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tabular-nums text-slate-500"
                    aria-hidden
                  >
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={rateJunior}
                    onChange={(e) => setRateJunior(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-7 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">高中價</span>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tabular-nums text-slate-500"
                    aria-hidden
                  >
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={rateSenior}
                    onChange={(e) => setRateSenior(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-7 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">單人價</span>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tabular-nums text-slate-500"
                    aria-hidden
                  >
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={rateSingle}
                    onChange={(e) => setRateSingle(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-7 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  />
                </div>
              </label>

              <div className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">顏色</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={tutorColorHex}
                    onChange={(event) => {
                      const v = event.target.value.toLowerCase();
                      setTutorColorHex(v);
                      setHexTextDraft(v);
                    }}
                    className="h-10 w-11 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-1"
                    title="選擇顏色"
                    aria-label="選擇導師顏色"
                  />
                  <input
                    type="text"
                    value={hexTextDraft}
                    onChange={(event) => setHexTextDraft(event.target.value)}
                    onBlur={() => {
                      const n = normalizeHexColor(hexTextDraft);
                      if (n) {
                        setTutorColorHex(n);
                        setHexTextDraft(n);
                      } else {
                        setHexTextDraft(tutorColorHex);
                      }
                    }}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-xs text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                    placeholder="#1d76c2"
                  />
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">狀態</span>
                <select
                  value={teacherStatus}
                  onChange={(event) => setTeacherStatus(event.target.value as TeacherStatus)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                >
                  {TEACHER_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {TEACHER_STATUS_DISPLAY[s]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onSubmitTeacher()}
                  disabled={isSaving}
                  className="h-10 rounded-lg bg-[#1d76c2] px-4 text-sm font-semibold text-white hover:bg-[#1663a3] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editingId ? "儲存老師" : "新增老師"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </div>

            {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}
            {dataError ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                讀取 tutors 表失敗：{dataError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋 ID／中文／英文全名（例如：T001、王小明、Samuel）"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] sm:max-w-[520px]"
              />
              <div className="flex items-center gap-2">
                <p className="text-sm text-slate-600">已選取：{selectedIds.length} 位老師</p>
                <button
                  type="button"
                  onClick={startEditSelected}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  編輯
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSelected()}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  刪除
                </button>
              </div>
            </div>
            {selectionError ? <p className="mt-2 text-sm text-red-600">{selectionError}</p> : null}

            <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
                    <th className="whitespace-nowrap px-4 py-3">
                      <input
                        type="checkbox"
                        checked={Boolean(firstFilteredTeacherId) && selectedIds.length === 1 && selectedIds[0] === firstFilteredTeacherId}
                        onChange={(event) => {
                          if (!event.target.checked) {
                            setSelectedIds([]);
                            return;
                          }
                          // 單選模式下，「全選」改為選取目前列表第一筆，避免多選造成邏輯混亂
                          setSelectedIds(firstFilteredTeacherId ? [firstFilteredTeacherId] : []);
                        }}
                        className="h-4 w-4 accent-[#1d76c2]"
                        aria-label="全選老師"
                      />
                    </th>
                    <TeacherSortableHeader label="老師ID" columnKey="id" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <TeacherSortableHeader label="老師姓名" columnKey="name" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <TeacherSortableHeader
                      label="英文全名"
                      columnKey="nameEn"
                      sortConfig={sortConfig}
                      setSortConfig={setSortConfig}
                    />
                    <TeacherSortableHeader label="初中價" columnKey="junior" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <TeacherSortableHeader label="高中價" columnKey="senior" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <TeacherSortableHeader label="單人價" columnKey="single" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-700">
                      顏色
                    </th>
                    <TeacherSortableHeader label="狀態" columnKey="status" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedTeachers.map((teacher) => {
                    const rowColorHex = resolveTutorColorHex(teacher.colorHex);
                    return (
                      <tr key={teacher.id}>
                        <td className="whitespace-nowrap px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.length === 1 && selectedIds[0] === teacher.id}
                            onChange={(event) => {
                              if (event.target.checked) setSelectedIds([teacher.id]);
                              else setSelectedIds([]);
                            }}
                            className="h-4 w-4 accent-[#1d76c2]"
                            aria-label={`勾選 ${teacher.id}`}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-800">{teacher.id}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{teacher.nameZh || "—"}</td>
                        <td className="max-w-[220px] px-4 py-3 text-sm text-slate-700">{teacher.nameEn || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
                          {formatRateDisplay(teacher.junior ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
                          {formatRateDisplay(teacher.senior ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-700">
                          {formatRateDisplay(teacher.single ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className="inline-block h-7 w-7 rounded-md border border-slate-200 shadow-sm"
                            style={{ backgroundColor: rowColorHex }}
                            title={rowColorHex}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                              getTeacherStatusBadgeClass(teacher.status),
                            ].join(" ")}
                          >
                            {TEACHER_STATUS_DISPLAY[teacher.status]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!isLoading && filteredTeachers.length === 0 ? (
                <div className="border-t border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  {teachers.length === 0 ? "目前沒有老師資料，請先新增。" : `找不到符合「${query}」的老師。`}
                </div>
              ) : null}
              {isLoading ? (
                <div className="border-t border-slate-200 px-4 py-6 text-center text-sm text-slate-500">讀取老師資料中...</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type TeacherSortableHeaderProps = {
  label: string;
  columnKey: TeacherSortKey;
  sortConfig: TeacherSortConfig;
  setSortConfig: (config: TeacherSortConfig) => void;
};

function TeacherSortableHeader({
  label,
  columnKey,
  sortConfig,
  setSortConfig,
}: TeacherSortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-700">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span>{label}</span>
        <select
          aria-label={`${label} 排序`}
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}
