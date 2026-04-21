"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AppTopNav from "@/components/AppTopNav";
import { normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay, gradeRank, normalizeGradeCode } from "@/lib/grade";
import { resolveStudentInactiveEffectiveDate } from "@/lib/studentVisibility";

type Student = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  birthDate: string;
  studentPhone: string;
  email: string;
  school: string;
  textbookPublisher: string;
  grade: string;
  mathLanguage: string;
};
type SortDirection = "asc" | "desc";
type SortConfig = { key: keyof Student; direction: SortDirection } | null;
type StudentRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  nickname_en: string | null;
  birth_date: string | null;
  student_phone: string | null;
  email: string | null;
  school: string | null;
  textbook_publisher: string | null;
  grade: string | null;
  math_language: string | null;
};
type VisibilityRow = {
  student_id: string | null;
  mode: string | null;
  effective_date: string | null;
};

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";
const TEXTBOOK_PUBLISHER_OPTIONS = [
  "Chung Tai",
  "Ephhk",
  "HKEP",
  "Modern",
  "Oxford",
  "Pearson",
  "Aristo",
] as const;

type StudentForm = Omit<Student, "id">;

const emptyForm: StudentForm = {
  nameZh: "",
  nameEn: "",
  nicknameEn: "",
  birthDate: "",
  studentPhone: "",
  email: "",
  school: "",
  textbookPublisher: "",
  grade: "",
  mathLanguage: "English",
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [manualInactiveEffectiveById, setManualInactiveEffectiveById] = useState<Map<string, string>>(
    new Map(),
  );

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomTrackRef = useRef<HTMLDivElement | null>(null);
  const sideScrollRef = useRef<HTMLDivElement | null>(null);
  const sideTrackRef = useRef<HTMLDivElement | null>(null);
  const [bottomScrollWidth, setBottomScrollWidth] = useState(0);
  const [bottomScrollClientWidth, setBottomScrollClientWidth] = useState(0);
  const [sideScrollHeight, setSideScrollHeight] = useState(0);
  const [sideScrollClientHeight, setSideScrollClientHeight] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const todayHkIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const year = Number(todayHkIso.slice(0, 4)) || new Date().getFullYear();

    if (!keyword) {
      return students.filter((student) => {
        if (statusFilter === "all") return true;
        const eff = resolveStudentInactiveEffectiveDate({
          grade: student.grade,
          manualInactiveEffective: manualInactiveEffectiveById.get(student.id) ?? null,
          year,
        });
        const isInactive = Boolean(eff && eff <= todayHkIso);
        return statusFilter === "inactive" ? isInactive : !isInactive;
      });
    }

    return students.filter((student) => {
      const eff = resolveStudentInactiveEffectiveDate({
        grade: student.grade,
        manualInactiveEffective: manualInactiveEffectiveById.get(student.id) ?? null,
        year,
      });
      const isInactive = Boolean(eff && eff <= todayHkIso);
      if (statusFilter === "inactive" && !isInactive) return false;
      if (statusFilter === "active" && isInactive) return false;
      return (
        student.id.toLowerCase().includes(keyword) ||
        normalizeStudentId(student.id).toLowerCase().includes(keyword) ||
        student.nameZh.toLowerCase().includes(keyword) ||
        student.nameEn.toLowerCase().includes(keyword) ||
        student.nicknameEn.toLowerCase().includes(keyword) ||
        student.textbookPublisher.toLowerCase().includes(keyword) ||
        student.studentPhone.toLowerCase().includes(keyword)
      );
    });
  }, [manualInactiveEffectiveById, query, statusFilter, students]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const sortedStudents = useMemo(() => {
    const copied = [...filteredStudents];

    if (!sortConfig) {
      copied.sort((a, b) => {
        const na = Number(normalizeStudentId(a.id)) || Number.MAX_SAFE_INTEGER;
        const nb = Number(normalizeStudentId(b.id)) || Number.MAX_SAFE_INTEGER;
        return na - nb;
      });
      return copied;
    }

    copied.sort((a, b) => {
      let result = 0;
      const { key } = sortConfig;

      if (key === "grade") {
        result = gradeRank(a.grade) - gradeRank(b.grade);
      } else if (key === "birthDate") {
        result = new Date(a.birthDate).getTime() - new Date(b.birthDate).getTime();
      } else {
        result = String(a[key]).localeCompare(String(b[key]), "zh-Hant");
      }

      return sortConfig.direction === "asc" ? result : -result;
    });

    return copied;
  }, [filteredStudents, sortConfig]);

  const nextStudentId = useMemo(() => getNextStudentId(students), [students]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIdSet = useMemo(
    () => new Set(sortedStudents.map((student) => student.id)),
    [sortedStudents],
  );
  const allVisibleSelected =
    sortedStudents.length > 0 &&
    sortedStudents.every((student) => selectedIdSet.has(student.id));

  async function loadStudents() {
    setIsLoading(true);
    setDataError("");
    const [{ data, error }, { data: visibilityRows, error: visibilityError }] = await Promise.all([
      supabase.from("students").select("*").order("id", { ascending: true }),
      supabase.from("student_visibility_modes").select("student_id, mode, effective_date"),
    ]);

    if (error || visibilityError) {
      setDataError("Failed to load student records. Please check your Supabase configuration and tables.");
      setIsLoading(false);
      return;
    }

    const mapped = (data as StudentRow[]).map(mapRowToStudent);
    setStudents(mapped);
    setSelectedIds((prev) => {
      const mappedIdSet = new Set(mapped.map((student) => student.id));
      return prev.filter((id) => mappedIdSet.has(id));
    });
    const inactiveMap = new Map<string, string>();
    for (const row of (visibilityRows ?? []) as VisibilityRow[]) {
      const mode = String(row.mode ?? "").toLowerCase();
      const sid = String(row.student_id ?? "");
      const eff = String(row.effective_date ?? "");
      if (mode === "inactive" && sid && eff) inactiveMap.set(sid, eff);
    }
    setManualInactiveEffectiveById(inactiveMap);
    setIsLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const tableEl = tableScrollRef.current;
    const bottomEl = bottomScrollRef.current;
    const sideEl = sideScrollRef.current;
    if (!tableEl) return;

    let syncing = false;

    const updateMetrics = () => {
      setBottomScrollWidth(tableEl.scrollWidth);
      setBottomScrollClientWidth(tableEl.clientWidth);
      setSideScrollHeight(tableEl.scrollHeight);
      setSideScrollClientHeight(tableEl.clientHeight);
    };

    const onTableScroll = () => {
      if (syncing) return;
      syncing = true;
      setScrollLeft(tableEl.scrollLeft);
      setScrollTop(tableEl.scrollTop);
      syncing = false;
    };

    updateMetrics();
    setScrollLeft(tableEl.scrollLeft);
    setScrollTop(tableEl.scrollTop);
    tableEl.addEventListener("scroll", onTableScroll, { passive: true });

    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(tableEl);

    return () => {
      tableEl.removeEventListener("scroll", onTableScroll);
      ro.disconnect();
    };
  }, [sortedStudents.length]);

  const bottomThumb = useMemo(() => {
    const trackEl = bottomTrackRef.current;
    const trackWidth = trackEl?.clientWidth ?? 0;
    if (!trackWidth || !bottomScrollWidth || !bottomScrollClientWidth) return { size: 0, offset: 0 };
    const ratio = bottomScrollClientWidth / bottomScrollWidth;
    const size = Math.max(28, Math.floor(trackWidth * ratio));
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);
    const offset = Math.round((scrollLeft / maxScroll) * maxOffset);
    return { size, offset };
  }, [bottomScrollClientWidth, bottomScrollWidth, scrollLeft]);

  const sideThumb = useMemo(() => {
    const trackEl = sideTrackRef.current;
    const trackHeight = trackEl?.clientHeight ?? 0;
    if (!trackHeight || !sideScrollHeight || !sideScrollClientHeight) return { size: 0, offset: 0 };
    const ratio = sideScrollClientHeight / sideScrollHeight;
    const size = Math.max(28, Math.floor(trackHeight * ratio));
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);
    const offset = Math.round((scrollTop / maxScroll) * maxOffset);
    return { size, offset };
  }, [sideScrollClientHeight, sideScrollHeight, scrollTop]);

  const onBottomTrackMouseDown = (e: React.MouseEvent) => {
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { size } = bottomThumb;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

    const targetOffset = Math.min(maxOffset, Math.max(0, x - size / 2));
    tableEl.scrollLeft = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const onSideTrackMouseDown = (e: React.MouseEvent) => {
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { size } = sideThumb;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

    const targetOffset = Math.min(maxOffset, Math.max(0, y - size / 2));
    tableEl.scrollTop = Math.round((targetOffset / Math.max(1, maxOffset)) * maxScroll);
  };

  const startDragBottomThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = bottomTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startX = e.clientX;
    const startOffset = bottomThumb.offset;
    const size = bottomThumb.size;
    const trackWidth = rect.width;
    const maxOffset = Math.max(0, trackWidth - size);
    const maxScroll = Math.max(1, bottomScrollWidth - bottomScrollClientWidth);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dx));
      tableEl.scrollLeft = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDragSideThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = sideTrackRef.current;
    const tableEl = tableScrollRef.current;
    if (!track || !tableEl) return;
    const rect = track.getBoundingClientRect();
    const startY = e.clientY;
    const startOffset = sideThumb.offset;
    const size = sideThumb.size;
    const trackHeight = rect.height;
    const maxOffset = Math.max(0, trackHeight - size);
    const maxScroll = Math.max(1, sideScrollHeight - sideScrollClientHeight);

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const nextOffset = Math.min(maxOffset, Math.max(0, startOffset + dy));
      tableEl.scrollTop = Math.round((nextOffset / Math.max(1, maxOffset)) * maxScroll);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onFieldChange = (field: keyof StudentForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveStudent = () => {
    void saveStudentAsync();
  };

  const saveStudentAsync = async () => {
    setFormError("");
    setFormNotice("");

    if (editingId) {
      const { error } = await supabase
        .from("students")
        .update(mapFormToRow(form))
        .eq("id", editingId);

      if (error) {
        setFormError(`Failed to save changes: ${error.message}`);
        return;
      }

      await loadStudents();
      setEditingId(null);
      setForm(emptyForm);
      setSelectedIds([]);
      setFormNotice("Student record updated successfully.");
      return;
    }

    const { error } = await supabase
      .from("students")
      .insert([{ id: nextStudentId, ...mapFormToRow(form) }]);

    if (error) {
      setFormError(`Failed to add student: ${error.message}`);
      return;
    }

    await loadStudents();
    setForm(emptyForm);
    setFormNotice("Student record added successfully.");
  };

  const startEditSelected = () => {
    if (selectedIds.length !== 1) {
      setSelectionError("Please select exactly 1 student to edit.");
      return;
    }

    const target = studentById.get(selectedIds[0]);
    if (!target) {
      setSelectionError("Could not find the selected student record.");
      return;
    }

    setFormError("");
    setSelectionError("");
    setEditingId(target.id);
    setForm({
      nameZh: target.nameZh,
      nameEn: target.nameEn,
      nicknameEn: target.nicknameEn,
      birthDate: target.birthDate,
      studentPhone: target.studentPhone,
      email: target.email,
      school: target.school,
      textbookPublisher: TEXTBOOK_PUBLISHER_OPTIONS.includes(target.textbookPublisher as (typeof TEXTBOOK_PUBLISHER_OPTIONS)[number])
        ? target.textbookPublisher
        : "",
      grade: formatGradeDisplay(target.grade),
      mathLanguage: target.mathLanguage,
    });
  };

  const deleteSelectedStudents = () => {
    void deleteSelectedStudentsAsync();
  };

  const deleteSelectedStudentsAsync = async () => {
    if (selectedIds.length === 0) {
      setShowDeleteConfirm(false);
      return;
    }
    setFormNotice("");

    const { error } = await supabase.from("students").delete().in("id", selectedIds);
    if (error) {
      setSelectionError("Delete failed. Please try again later.");
      setShowDeleteConfirm(false);
      return;
    }

    await loadStudents();
    const deletedCount = selectedIds.length;
    setSelectedIds([]);
    setSelectionError("");
    setShowDeleteConfirm(false);
    setFormNotice(
      deletedCount === 1
        ? "Student record deleted successfully."
        : `${deletedCount} student records deleted successfully.`,
    );
    if (editingId && selectedIds.includes(editingId)) {
      setEditingId(null);
      setForm(emptyForm);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="students" />

        <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">All Student Information</h1>
            <p className="mt-1 text-sm text-blue-100">
              Fill in the form below to add a student (single entry).
            </p>
            <p className="mt-1 text-xs text-blue-100/90">
              System ID: {editingId ?? nextStudentId} (auto-numbered, starting from 00001)
            </p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InputField
                label="Student name (Chinese)"
                value={form.nameZh}
                onChange={(v) => onFieldChange("nameZh", v)}
              />
              <InputField
                label="Student name (English)"
                value={form.nameEn}
                onChange={(v) => onFieldChange("nameEn", v)}
              />
              <InputField
                label="Nickname"
                value={form.nicknameEn}
                onChange={(v) => onFieldChange("nicknameEn", v)}
              />
              <InputField
                label="Date of birth"
                type="date"
                value={form.birthDate}
                onChange={(v) => onFieldChange("birthDate", v)}
              />
              <InputField
                label="Contact number"
                value={form.studentPhone}
                onChange={(v) => onFieldChange("studentPhone", v)}
              />
              <InputField
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => onFieldChange("email", v)}
              />
              <InputField
                label="School"
                value={form.school}
                onChange={(v) => onFieldChange("school", v)}
              />
              <InputField
                label="Textbook publisher"
                value={form.textbookPublisher}
                onChange={(v) => onFieldChange("textbookPublisher", v)}
                type="select"
                options={[...TEXTBOOK_PUBLISHER_OPTIONS]}
              />
              <InputField
                label="Grade"
                value={form.grade}
                onChange={(v) => onFieldChange("grade", v)}
                type="select"
                options={["F.1", "F.2", "F.3", "F.4", "F.5", "F.6"]}
              />
              <div className="md:col-span-2 xl:col-span-3 flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
                <fieldset className="block md:basis-[45%] md:flex-none">
                  <legend className="mb-1 block text-sm font-semibold text-slate-700">
                    Maths instruction language
                  </legend>
                  <div className="flex h-[42px] items-center gap-4 rounded-lg border border-slate-300 bg-white px-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="radio"
                        name="mathLanguage"
                        value="Chinese"
                        checked={form.mathLanguage === "Chinese"}
                        onChange={(event) => onFieldChange("mathLanguage", event.target.value)}
                        className="h-4 w-4 accent-[#1d76c2]"
                      />
                      Chinese
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="radio"
                        name="mathLanguage"
                        value="English"
                        checked={form.mathLanguage === "English"}
                        onChange={(event) => onFieldChange("mathLanguage", event.target.value)}
                        className="h-4 w-4 accent-[#1d76c2]"
                      />
                      English
                    </label>
                  </div>
                </fieldset>

                <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-3 md:basis-[55%] md:flex-none md:pr-[1%] md:pb-[2px]">
                  {formNotice ? (
                    <p className="mr-auto text-sm font-medium text-emerald-700">{formNotice}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={saveStudent}
                    className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-base font-semibold text-white transition hover:opacity-90"
                    style={{ backgroundImage: PRIMARY_GRADIENT }}
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                      <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
                    </svg>
                    <span>{editingId ? "Save changes" : "Add student record"}</span>
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setForm(emptyForm);
                        setFormError("");
                        setFormNotice("");
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-6 py-2.5 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
            {formError && (
              <p className="mt-2 text-sm font-medium text-red-600">{formError}</p>
            )}
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-center">
            <div className="md:col-span-5">
              <label
                htmlFor="student-search"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                <span className="inline-flex items-center gap-2">
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="currentColor" aria-hidden="true">
                    <path d="M8.5 2.75a5.75 5.75 0 104.02 9.86l2.93 2.93a.75.75 0 101.06-1.06l-2.93-2.93A5.75 5.75 0 008.5 2.75zm-4.25 5.75a4.25 4.25 0 118.5 0 4.25 4.25 0 01-8.5 0z" />
                  </svg>
                  <span>Search by ID / Chinese name / English name / nickname / Contact number</span>
                </span>
              </label>
              <input
                id="student-search"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. 00001, 王小明, Tom, 91234567, Oxford"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none ring-0 transition focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
              />
            </div>
            <div className="md:col-span-4">
              <div className="flex items-center justify-start gap-3 overflow-x-auto md:justify-center">
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className={`whitespace-nowrap rounded-md border px-5 py-2.5 text-sm font-semibold transition ${
                    statusFilter === "all"
                      ? "border-[#1d76c2] bg-[#1d76c2] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  All Students
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("active")}
                  className={`whitespace-nowrap rounded-md border px-5 py-2.5 text-sm font-semibold transition ${
                    statusFilter === "active"
                      ? "border-[#1d76c2] bg-[#1d76c2] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Active Students
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("inactive")}
                  className={`whitespace-nowrap rounded-md border px-5 py-2.5 text-sm font-semibold transition ${
                    statusFilter === "inactive"
                      ? "border-[#1d76c2] bg-[#1d76c2] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Inactive Students
                </button>
              </div>
            </div>
            <div className="md:col-span-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    Selected: <span className="font-semibold text-slate-900">{selectedIds.length}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={startEditSelected}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M14.69 2.86a2 2 0 112.83 2.83l-8.4 8.4a1 1 0 01-.46.26l-3.32.83a.75.75 0 01-.9-.9l.83-3.32a1 1 0 01.26-.46l8.4-8.4zM4.75 16.25a.75.75 0 100 1.5h10.5a.75.75 0 000-1.5H4.75z" />
                    </svg>
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M7.5 2.75A1.75 1.75 0 005.75 4.5v.25H4a.75.75 0 000 1.5h.5l.73 9.1A2 2 0 007.22 17.2h5.56a2 2 0 001.99-1.85l.73-9.1H16a.75.75 0 000-1.5h-1.75V4.5A1.75 1.75 0 0012.5 2.75h-5zM12.75 4.5v.25h-5.5V4.5a.25.25 0 01.25-.25h5a.25.25 0 01.25.25z" />
                    </svg>
                    <span>Delete</span>
                  </button>
                  </div>
                </div>
                {selectionError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{selectionError}</p>
                )}
                {dataError && (
                  <p className="mt-2 text-xs font-medium text-red-600">{dataError}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex">
            <div
              ref={tableScrollRef}
              className="max-h-[70vh] flex-1 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <table className="min-w-[1500px] divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="divide-x divide-slate-200">
                    <th className="sticky top-0 z-30 whitespace-nowrap bg-slate-50 px-6 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setSelectionError("");
                            setSelectedIds((prev) => {
                              const merged = new Set([...prev, ...sortedStudents.map((s) => s.id)]);
                              return Array.from(merged);
                            });
                          } else {
                            setSelectionError("");
                            setSelectedIds((prev) =>
                              prev.filter((id) => !visibleIdSet.has(id)),
                            );
                          }
                        }}
                        className="h-4 w-4 accent-[#1d76c2]"
                      />
                    </th>
                    <SortableHeader
                      label="ID"
                      columnKey="id"
                      sortConfig={sortConfig}
                      setSortConfig={setSortConfig}
                      thClassName="w-[110px]"
                    />
                    <SortableHeader label="Chinese name" columnKey="nameZh" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader
                      label="English name"
                      columnKey="nameEn"
                      sortConfig={sortConfig}
                      setSortConfig={setSortConfig}
                      thClassName="w-[170px]"
                    />
                    <SortableHeader label="Nickname" columnKey="nicknameEn" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Date of birth" columnKey="birthDate" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Contact number" columnKey="studentPhone" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Email" columnKey="email" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="School" columnKey="school" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Textbook publisher" columnKey="textbookPublisher" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Grade" columnKey="grade" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                    <SortableHeader label="Maths instruction" columnKey="mathLanguage" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedStudents.map((student) => {
                    const studentIdDisplay = normalizeStudentId(student.id);
                    return (
                      <tr
                        key={student.id}
                        className="divide-x divide-slate-100 bg-white hover:bg-slate-50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={selectedIdSet.has(student.id)}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectionError("");
                                setSelectedIds((prev) => [...prev, student.id]);
                              } else {
                                setSelectionError("");
                                setSelectedIds((prev) => prev.filter((id) => id !== student.id));
                              }
                            }}
                            className="h-4 w-4 accent-[#1d76c2]"
                          />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">
                          <Link
                            href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons`}
                            className="text-[#1d76c2] hover:underline"
                          >
                            {studentIdDisplay}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.nameZh}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 align-top">
                          <span className="inline-block max-w-[20ch] break-words whitespace-normal leading-5">
                            {student.nameEn}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.nicknameEn}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.birthDate}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 align-top">
                          <span className="inline-block max-w-[9ch] break-all whitespace-normal leading-5">
                            {student.studentPhone}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.email}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.school}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.textbookPublisher}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {formatGradeDisplay(student.grade)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                          {student.mathLanguage}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {sideScrollHeight > sideScrollClientHeight ? (
              <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
                <div
                  ref={sideScrollRef}
                  className="sr-only"
                  aria-hidden
                />
                <div
                  ref={sideTrackRef}
                  role="scrollbar"
                  aria-label="Vertical scrollbar"
                  className="relative w-2.5 select-none rounded bg-white ring-1 ring-slate-200"
                  style={{ height: "calc(70vh - 16px)" }}
                  onMouseDown={onSideTrackMouseDown}
                >
                  <div
                    className="absolute left-0 right-0 rounded bg-slate-400/80 hover:bg-slate-500"
                    style={{ height: sideThumb.size, transform: `translateY(${sideThumb.offset}px)` }}
                    onMouseDown={startDragSideThumb}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {bottomScrollWidth > bottomScrollClientWidth ? (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2">
              <div ref={bottomScrollRef} className="sr-only" aria-hidden />
              <div
                ref={bottomTrackRef}
                role="scrollbar"
                aria-label="Horizontal scrollbar"
                className="relative h-2.5 select-none rounded bg-white ring-1 ring-slate-200"
                onMouseDown={onBottomTrackMouseDown}
              >
                <div
                  className="absolute bottom-0 top-0 rounded bg-slate-400/80 hover:bg-slate-500"
                  style={{ width: bottomThumb.size, transform: `translateX(${bottomThumb.offset}px)` }}
                  onMouseDown={startDragBottomThumb}
                />
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">
              Loading student records…
            </div>
          ) : sortedStudents.length === 0 ? (
            <div className="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">
              {students.length === 0
                ? "No student records yet. Add one using the form above."
                : `No students found matching "${query}".`}
            </div>
          ) : null}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Confirm delete</h2>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to delete the selected {selectedIds.length} student record(s)?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteSelectedStudents}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type InputFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "email" | "select";
  options?: string[];
};

function InputField({ label, value, onChange, type = "text", options = [] }: InputFieldProps) {
  if (type === "select") {
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
      />
    </label>
  );
}

type SortableHeaderProps = {
  label: string;
  columnKey: keyof Student;
  sortConfig: SortConfig;
  setSortConfig: (config: SortConfig) => void;
  thClassName?: string;
};

function SortableHeader({ label, columnKey, sortConfig, setSortConfig, thClassName }: SortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th
      className={[
        "sticky top-0 z-20 whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-[11px] font-bold tracking-wider text-slate-700",
        thClassName ?? "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="whitespace-nowrap">{label}</span>
        <select
          aria-label={`Sort by ${label}`}
          value={selectedDirection}
          onChange={(event) => {
            const direction = event.target.value as SortDirection | "";
            if (!direction) {
              setSortConfig(null);
              return;
            }
            setSortConfig({ key: columnKey, direction });
          }}
          className="h-6 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
        >
          <option value="">▽</option>
          <option value="asc">↑</option>
          <option value="desc">↓</option>
        </select>
      </div>
    </th>
  );
}

function getNextStudentId(students: Student[]) {
  const maxNumber = students.reduce((max, student) => {
    const normalized = normalizeStudentId(student.id);
    const match = /^(\d{1,5})$/i.exec(normalized.trim());
    if (!match) {
      return max;
    }
    return Math.max(max, Number(match[1]));
  }, 0);

  return String(maxNumber + 1).padStart(5, "0");
}

function mapRowToStudent(row: StudentRow): Student {
  return {
    id: row.id,
    nameZh: row.name_zh ?? "",
    nameEn: row.name_en ?? "",
    nicknameEn: row.nickname_en ?? "",
    birthDate: row.birth_date ?? "",
    studentPhone: row.student_phone ?? "",
    email: row.email ?? "",
    school: row.school ?? "",
    textbookPublisher: row.textbook_publisher ?? "",
    grade: normalizeGradeCode(row.grade),
    mathLanguage: row.math_language ?? "English",
  };
}

function mapFormToRow(form: StudentForm) {
  const nameZh = form.nameZh.trim();
  const nameEn = form.nameEn.trim();
  const nicknameEn = form.nicknameEn.trim();
  const birthDate = form.birthDate.trim();
  const studentPhone = form.studentPhone.trim();
  const email = form.email.trim();
  const school = form.school.trim();
  const textbookPublisher = String(form.textbookPublisher ?? "").trim();
  const grade = normalizeGradeCode(form.grade);
  const mathLanguage = form.mathLanguage.trim();
  return {
    name_zh: nameZh ? nameZh : null,
    name_en: nameEn ? nameEn : null,
    nickname_en: nicknameEn ? nicknameEn : null,
    birth_date: birthDate ? birthDate : null,
    student_phone: studentPhone ? studentPhone : null,
    email: email ? email : null,
    school: school ? school : null,
    textbook_publisher: textbookPublisher ? textbookPublisher : null,
    grade: grade ? grade : null,
    math_language: mathLanguage ? mathLanguage : null,
  };
}
