"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AppTopNav from "@/components/AppTopNav";
import type { AppTopNavViewer } from "@/lib/appTopNavViewer";
import ClientOnlyAfterMount from "@/components/ClientOnlyAfterMount";
import TextbookPublisherPicker from "@/components/TextbookPublisherPicker";
import { normalizeStudentId } from "@/lib/studentId";
import { formatGradeDisplay, gradeRank, normalizeGradeCode } from "@/lib/grade";
import { gradeToTextbookBand, resolveTextbookSelection } from "@/lib/textbookPublisherCatalog";
import { parseStudentPasteBatch } from "@/lib/parseStudentPasteText";
import {
  validateStudentContactPhone,
  validateStudentEmailFormat,
} from "@/lib/studentPortalCredentials";
import { useCustomScrollbars } from "@/lib/useCustomScrollbars";

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
  birthTs: number;
  searchBlob: string;
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
const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";
const STUDENTS_PAGE_SIZE = 80;
const STUDENTS_SEARCH_DEBOUNCE_MS = 300;

type StudentPortalStatus = {
  studentId: string;
  hasAccount: boolean;
  authEmail: string | null;
  loginAllowed: boolean;
  reactivateDate: string | null;
  ready: boolean;
  readyReason: string | null;
  studentIdLoginOnly?: boolean;
};

export type StudentsPageInitialList = {
  students: StudentRow[];
  total: number;
  portalStatusById: Record<string, StudentPortalStatus>;
};

type StudentForm = Omit<Student, "id" | "birthTs" | "searchBlob">;

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

function buildStudentSearchBlob(student: {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  school: string;
  textbookPublisher: string;
  studentPhone: string;
}) {
  return [
    student.id,
    normalizeStudentId(student.id),
    student.nameZh,
    student.nameEn,
    student.nicknameEn,
    student.school,
    student.textbookPublisher,
    student.studentPhone,
  ]
    .join(" ")
    .toLowerCase();
}

export default function StudentsPageClient({
  navViewer = null,
  initialList = null,
}: {
  navViewer?: AppTopNavViewer | null;
  initialList?: StudentsPageInitialList | null;
}) {
  const [students, setStudents] = useState<Student[]>(() =>
    (initialList?.students ?? []).map(mapRowToStudent),
  );
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [duplicateEmailPrompt, setDuplicateEmailPrompt] = useState<{
    otherStudentId: string;
    email: string;
    /** pending add after user confirms student-id-only portal */
    mode: "add" | "provision";
    provisionStudentId?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(() => !initialList);
  const [pageLoading, setPageLoading] = useState(false);
  const [listTotal, setListTotal] = useState(() => initialList?.total ?? 0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllStudents, setShowAllStudents] = useState(false);
  const [suggestedNextId, setSuggestedNextId] = useState("00001");
  const [dataError, setDataError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [inactiveKind, setInactiveKind] = useState<"all" | "temporary" | "graduated">("all");
  const [savingForm, setSavingForm] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteNotice, setPasteNotice] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  const [portalStatusById, setPortalStatusById] = useState<Record<string, StudentPortalStatus>>(
    () => initialList?.portalStatusById ?? {},
  );
  const [portalBusyId, setPortalBusyId] = useState<string | null>(null);
  const [portalNotice, setPortalNotice] = useState("");

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const skipInitialListRef = useRef(Boolean(initialList));
  const isAdmin = navViewer?.role === "admin";

  const sortedStudents = useMemo(() => {
    const copied = [...students];

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
        result = a.birthTs - b.birthTs;
      } else {
        result = String(a[key]).localeCompare(String(b[key]), "zh-Hant");
      }

      return sortConfig.direction === "asc" ? result : -result;
    });

    return copied;
  }, [students, sortConfig]);

  const {
    tableScrollId,
    bottomTrackRef,
    sideTrackRef,
    bottomThumb,
    sideThumb,
    bottomScrollWidth,
    bottomScrollClientWidth,
    sideScrollHeight,
    sideScrollClientHeight,
    bottomTrackA11yProps,
    sideTrackA11yProps,
    onBottomTrackMouseDown,
    onSideTrackMouseDown,
    startDragBottomThumb,
    startDragSideThumb,
  } = useCustomScrollbars({
    tableScrollRef,
    contentKey: sortedStudents.length,
  });

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIdSet = useMemo(
    () => new Set(sortedStudents.map((student) => student.id)),
    [sortedStudents],
  );
  const allVisibleSelected =
    sortedStudents.length > 0 &&
    sortedStudents.every((student) => selectedIdSet.has(student.id));

  const totalPages = Math.max(1, Math.ceil(listTotal / STUDENTS_PAGE_SIZE));

  const VISIBLE_PAGE_COUNT = 5;

  const pageNumberItems = useMemo(() => {
    if (totalPages <= VISIBLE_PAGE_COUNT) {
      return Array.from({ length: VISIBLE_PAGE_COUNT }, (_, i) => i + 1);
    }
    let start = Math.max(1, currentPage - 2);
    if (start + VISIBLE_PAGE_COUNT - 1 > totalPages) {
      start = totalPages - VISIBLE_PAGE_COUNT + 1;
    }
    return Array.from({ length: VISIBLE_PAGE_COUNT }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  const fetchStudentsPage = useCallback(
    async (options: { page?: number; showAll?: boolean }) => {
      const page = Math.max(1, options.page ?? 1);
      const showAll = Boolean(options.showAll);
        if (showAll) {
          setIsLoading(true);
          setShowAllStudents(true);
          setCurrentPage(1);
        } else {
          setShowAllStudents(false);
          setCurrentPage(page);
          if (page === 1) setIsLoading(true);
          else setPageLoading(true);
        }
      setDataError("");

      try {
        const q = query.trim();
        const fetchBatch = async (offset: number, limit: number) => {
          const params = new URLSearchParams({
            offset: String(offset),
            limit: String(limit),
            status: statusFilter,
          });
          if (q) params.set("q", q);
          if (statusFilter === "inactive") params.set("inactiveKind", inactiveKind);
          const res = await fetch(`/api/students/list?${params.toString()}`, { credentials: "same-origin" });
          const body = (await res.json()) as {
            ok?: boolean;
            error?: string;
            students?: StudentRow[];
            total?: number;
            hasMore?: boolean;
            portalStatusById?: Record<string, StudentPortalStatus>;
          };
          if (!res.ok || !body.ok) {
            throw new Error(body.error ?? "Failed to load student records.");
          }
          return body;
        };

        if (showAll) {
          const merged: Student[] = [];
          const mergedPortal: Record<string, StudentPortalStatus> = {};
          let offset = 0;
          let total = 0;
          let hasMore = true;
          while (hasMore) {
            const body = await fetchBatch(offset, 200);
            const mapped = (body.students ?? []).map(mapRowToStudent);
            merged.push(...mapped);
            Object.assign(mergedPortal, body.portalStatusById ?? {});
            total = body.total ?? merged.length;
            hasMore = Boolean(body.hasMore) && mapped.length > 0;
            offset += mapped.length;
            if (!mapped.length) break;
          }
          setStudents(merged);
          setPortalStatusById(mergedPortal);
          setSelectedIds((prev) => prev.filter((id) => merged.some((s) => s.id === id)));
          setListTotal(total || merged.length);
          return;
        }

        const body = await fetchBatch((page - 1) * STUDENTS_PAGE_SIZE, STUDENTS_PAGE_SIZE);
        const mapped = (body.students ?? []).map(mapRowToStudent);
        setStudents(mapped);
        setPortalStatusById(body.portalStatusById ?? {});
        setSelectedIds((prev) => prev.filter((id) => mapped.some((s) => s.id === id)));
        setListTotal(body.total ?? mapped.length);
      } catch (e) {
        setDataError(
          e instanceof Error ? e.message : "Failed to load student records. Please check your configuration.",
        );
      } finally {
        setIsLoading(false);
        setPageLoading(false);
      }
    },
    [query, statusFilter, inactiveKind],
  );

  const runPortalAction = useCallback(
    async (
      studentId: string,
      action: "provision" | "reset-password" | "sync-email",
      options?: { studentIdLoginOnly?: boolean },
    ) => {
      setPortalBusyId(studentId);
      setPortalNotice("");
      try {
        const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/portal-account`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            studentIdLoginOnly: options?.studentIdLoginOnly === true,
          }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          result?: { message?: string };
          status?: StudentPortalStatus | null;
        };
        if (!res.ok || !body.ok) {
          const err = body.error ?? "Portal action failed.";
          if (
            action === "provision" &&
            !options?.studentIdLoginOnly &&
            /already used by another student/i.test(err)
          ) {
            const student = students.find((s) => normalizeStudentId(s.id) === studentId);
            const email = (student?.email ?? "").trim().toLowerCase();
            const otherMatch = /student\s+(\d+)/i.exec(err);
            setDuplicateEmailPrompt({
              otherStudentId: otherMatch?.[1] ? normalizeStudentId(otherMatch[1]) : "?",
              email: email || "(shared email)",
              mode: "provision",
              provisionStudentId: studentId,
            });
            return;
          }
          throw new Error(err);
        }
        if (body.status) {
          setPortalStatusById((prev) => ({ ...prev, [studentId]: body.status! }));
        }
        setPortalNotice(body.result?.message ?? "Done.");
      } catch (e) {
        setPortalNotice(e instanceof Error ? e.message : "Portal action failed.");
      } finally {
        setPortalBusyId(null);
      }
    },
    [students],
  );

  const reloadStudentsList = useCallback(async () => {
    await fetchStudentsPage({ page: showAllStudents ? 1 : currentPage, showAll: showAllStudents });
    try {
      setSuggestedNextId(await fetchNextStudentIdFromDb());
    } catch {
      /* keep previous suggestion */
    }
  }, [fetchStudentsPage, showAllStudents, currentPage]);

  useEffect(() => {
    if (skipInitialListRef.current) {
      skipInitialListRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchStudentsPage({ page: 1, showAll: false });
    }, STUDENTS_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fetchStudentsPage, query, statusFilter, inactiveKind]);

  const onFieldChange = (field: keyof StudentForm, value: string) => {
    setForm((prev) => {
      if (field !== "grade") return { ...prev, [field]: value };
      const next = { ...prev, grade: value };
      const band = gradeToTextbookBand(value);
      if (!band || !prev.textbookPublisher) return next;
      const resolved = resolveTextbookSelection(value, prev.textbookPublisher);
      if (!resolved.publisher || !resolved.book) {
        next.textbookPublisher = "";
      }
      return next;
    });
  };

  const partialFieldsToForm = useCallback((fields: Partial<StudentForm>): StudentForm => {
    const next = { ...emptyForm };
    for (const [key, value] of Object.entries(fields) as Array<
      [keyof StudentForm, string | undefined]
    >) {
      if (value == null || value === "") continue;
      next[key] = value;
    }
    return next;
  }, []);

  const applyPasteToForm = useCallback(() => {
    const batch = parseStudentPasteBatch(pasteDraft);
    if (batch.students.length === 0) {
      setPasteNotice("");
      setPasteWarnings(batch.warnings);
      return;
    }

    const first = batch.students[0]!;
    setForm(partialFieldsToForm(first.fields));
    setEditingId(null);
    setFormError("");
    setFormNotice("");
    setPasteNotice(
      batch.students.length === 1
        ? `Filled ${first.matchedLabels.length} field(s) into the form. Review, then Add student record.`
        : `Detected ${batch.students.length} students. Filled row 1 into the form — use “Add all students” to insert everyone at once.`,
    );
    setPasteWarnings(batch.warnings);
  }, [pasteDraft, partialFieldsToForm]);

  const addAllFromPaste = useCallback(async () => {
    const batch = parseStudentPasteBatch(pasteDraft);
    if (batch.students.length === 0) {
      setPasteNotice("");
      setPasteWarnings(batch.warnings);
      return;
    }

    setSavingForm(true);
    setFormError("");
    setFormNotice("");
    setPasteNotice("");
    const addedIds: string[] = [];
    const failures: string[] = [];
    const portalNotes: string[] = [];

    try {
      for (let i = 0; i < batch.students.length; i += 1) {
        const row = batch.students[i]!;
        const formRow = partialFieldsToForm(row.fields);
        const label = formRow.nameEn || formRow.nameZh || formRow.nicknameEn || "student";

        const check = await validateStudentCredentialsForSave(formRow);
        if (!check.ok && !check.duplicateEmail) {
          failures.push(`Row ${i + 1} (${label}): ${check.error}`);
          continue;
        }

        let studentIdLoginOnly = false;
        if (!check.ok && check.duplicateEmail) {
          const useStudentId = window.confirm(
            `Row ${i + 1} (${label}): Email ${check.email} is already used by student ${check.otherStudentId}.\n\n` +
              `Use student ID only for Portal login?\n` +
              `(Password = contact number. Email login will not work for this student.)\n\n` +
              `Click OK = yes, Cancel = skip this row.`,
          );
          if (!useStudentId) {
            failures.push(
              `Row ${i + 1} (${label}): skipped — shared email with ${check.otherStudentId}, did not choose student-ID Portal.`,
            );
            continue;
          }
          studentIdLoginOnly = true;
        }

        let inserted = false;
        let candidateId = "";
        for (let attempt = 0; attempt < 5; attempt += 1) {
          candidateId = await fetchNextStudentIdFromDb();
          const { error } = await supabase
            .from("students")
            .insert([{ id: candidateId, ...mapFormToRow(formRow) }]);
          if (!error) {
            addedIds.push(candidateId);
            inserted = true;
            break;
          }
          if (!isDuplicateStudentIdError(error)) {
            failures.push(`Row ${i + 1} (${label}): ${error.message}`);
            inserted = true; // stop retrying this row
            break;
          }
        }
        if (!inserted) {
          failures.push(`Row ${i + 1}: could not allocate student ID.`);
          continue;
        }
        if (candidateId && addedIds.includes(candidateId)) {
          const portal = await provisionPortalAfterCreate(candidateId, { studentIdLoginOnly });
          if (!portal.ok) {
            portalNotes.push(`${candidateId}: student saved, portal not opened — ${portal.message}`);
          } else if (studentIdLoginOnly) {
            portalNotes.push(`${candidateId}: Portal opened — login with student ID only.`);
          }
        }
      }

      await reloadStudentsList();
      setEditingId(null);
      setForm(emptyForm);
      if (addedIds.length > 0) {
        setPasteDraft("");
        setPasteNotice(
          addedIds.length === 1
            ? `Added 1 student (ID ${addedIds[0]}).`
            : `Added ${addedIds.length} students (IDs ${addedIds[0]}–${addedIds[addedIds.length - 1]}).`,
        );
      }
      setPasteWarnings([...batch.warnings, ...failures, ...portalNotes]);
      if (addedIds.length === 0 && failures.length > 0) {
        setFormError(failures[0] ?? "Failed to add students.");
      }
    } finally {
      setSavingForm(false);
    }
  }, [pasteDraft, partialFieldsToForm, reloadStudentsList]);

  const insertNewStudentAndProvision = useCallback(
    async (studentIdLoginOnly: boolean) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidateId = await fetchNextStudentIdFromDb();
        const { error } = await supabase
          .from("students")
          .insert([{ id: candidateId, ...mapFormToRow(form) }]);

        if (!error) {
          const portal = await provisionPortalAfterCreate(candidateId, { studentIdLoginOnly });
          await reloadStudentsList();
          setForm(emptyForm);
          if (portal.ok) {
            setFormNotice(
              studentIdLoginOnly
                ? `Student record added (ID ${candidateId}). Portal opened — login with student ID + contact number (not email).`
                : `Student record added (ID ${candidateId}). Portal account opened — login with email + contact number.`,
            );
          } else {
            setFormNotice(`Student record added (ID ${candidateId}).`);
            setFormError(`Portal account was not opened: ${portal.message}`);
          }
          return;
        }

        if (!isDuplicateStudentIdError(error)) {
          setFormError(`Failed to add student: ${error.message}`);
          return;
        }
      }

      setFormError(
        "Failed to add student: could not allocate a new student ID (duplicate). Please refresh the page and try again.",
      );
    },
    [form, reloadStudentsList],
  );

  const saveStudent = () => {
    void saveStudentAsync();
  };

  const saveStudentAsync = async () => {
    setFormError("");
    setFormNotice("");
    setSavingForm(true);

    try {
      const check = await validateStudentCredentialsForSave(form, editingId ?? undefined);
      if (!check.ok && !check.duplicateEmail) {
        setFormError(check.error);
        return;
      }

      if (editingId) {
        if (!check.ok && check.duplicateEmail) {
          setFormError(
            `Email is already used by student ${check.otherStudentId}. Change to a unique email, or keep the current email.`,
          );
          return;
        }

        const { error } = await supabase
          .from("students")
          .update(mapFormToRow(form))
          .eq("id", editingId);

        if (error) {
          setFormError(`Failed to save changes: ${error.message}`);
          return;
        }

        await reloadStudentsList();
        setEditingId(null);
        setForm(emptyForm);
        setSelectedIds([]);
        setFormNotice("Student record updated successfully.");
        return;
      }

      if (!check.ok && check.duplicateEmail) {
        setDuplicateEmailPrompt({
          otherStudentId: check.otherStudentId,
          email: check.email,
          mode: "add",
        });
        return;
      }

      await insertNewStudentAndProvision(false);
    } finally {
      setSavingForm(false);
    }
  };

  const confirmDuplicateEmailStudentIdPortal = () => {
    const prompt = duplicateEmailPrompt;
    setDuplicateEmailPrompt(null);
    if (!prompt) return;
    if (prompt.mode === "provision" && prompt.provisionStudentId) {
      void runPortalAction(prompt.provisionStudentId, "provision", { studentIdLoginOnly: true });
      return;
    }
    setSavingForm(true);
    void insertNewStudentAndProvision(true).finally(() => setSavingForm(false));
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
      textbookPublisher: target.textbookPublisher,
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

    await reloadStudentsList();
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
        <AppTopNav highlight="students" viewer={navViewer} />

        <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">All Student Information</h1>
            <p className="mt-1 text-sm text-blue-100">
              Fill in the form below to add a student. A Portal account is opened automatically when
              email and contact number pass validation.
            </p>
            <p className="mt-1 text-xs text-blue-100/90">
              System ID: {editingId ?? suggestedNextId} (auto-numbered, starting from 00001)
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
                hint="Exactly 8 digits, no spaces (also used as Portal password)."
              />
              <InputField
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => onFieldChange("email", v)}
                hint="Must include @ and be unique (used as Portal login)."
              />
              <InputField
                label="School"
                value={form.school}
                onChange={(v) => onFieldChange("school", v)}
              />
              <InputField
                label="Grade"
                value={form.grade}
                onChange={(v) => onFieldChange("grade", v)}
                type="select"
                options={["F.1", "F.2", "F.3", "F.4", "F.5", "F.6"]}
              />
              <TextbookPublisherPicker
                grade={form.grade}
                value={form.textbookPublisher}
                onChange={(v) => onFieldChange("textbookPublisher", v)}
              />
              <div className="md:col-span-2 xl:col-span-3 flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
                <fieldset className="block md:basis-[45%] md:flex-none">
                  <legend className="mb-1 block text-sm font-semibold text-slate-700">
                    Maths instruction language
                  </legend>
                  <ClientOnlyAfterMount
                    fallback={
                      <div
                        className="flex h-[42px] items-center gap-4 rounded-lg border border-slate-300 bg-slate-50 px-3"
                        aria-hidden
                      >
                        <span className="text-sm text-slate-500">Chinese</span>
                        <span className="text-sm text-slate-500">English</span>
                      </div>
                    }
                  >
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
                  </ClientOnlyAfterMount>
                </fieldset>

                <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-3 md:basis-[55%] md:flex-none md:pr-[1%] md:pb-[2px]">
                  {formNotice ? (
                    <p className="mr-auto text-sm font-medium text-emerald-700">{formNotice}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={saveStudent}
                    disabled={savingForm}
                    className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Paste to add students</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                One student per line (tab-separated). Empty cells OK. Use “Add all students” for multiple rows,
                or “Fill form” to preview the first row.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void addAllFromPaste()}
                disabled={savingForm || !pasteDraft.trim()}
                className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1663a3] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingForm ? "Adding…" : "Add all students"}
              </button>
              <button
                type="button"
                onClick={applyPasteToForm}
                disabled={savingForm || !pasteDraft.trim()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Fill form (1st row)
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasteDraft("");
                  setPasteNotice("");
                  setPasteWarnings([]);
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear paste
              </button>
            </div>
          </div>
          <textarea
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            rows={5}
            placeholder={`One student per line:\nLau tsun kit	Bosco	2007年3月25日	54071413	boscolau02@gmail.com	華德福會瑪利亞書院	中六	中文\nChan Tai Man	Tom		91234567		聖保羅	中三	英文`}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
            suppressHydrationWarning
          />
          {pasteNotice ? (
            <p className="mt-2 text-sm font-medium text-emerald-700">{pasteNotice}</p>
          ) : null}
          {pasteWarnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
              {pasteWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
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
                  <span>Search by ID / Chinese name / English name / nickname / Contact number / School</span>
                </span>
              </label>
              <ClientOnlyAfterMount
                fallback={
                  <div
                    className="h-[42px] w-full rounded-lg border border-slate-300 bg-slate-50"
                    aria-hidden
                  />
                }
              >
                <input
                  id="student-search"
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. 00001, 王小明, Tom, 91234567, 聖保羅, Oxford"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none ring-0 transition focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                />
              </ClientOnlyAfterMount>
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
                  onClick={() => {
                    setStatusFilter("inactive");
                    setInactiveKind("all");
                  }}
                  className={`whitespace-nowrap rounded-md border px-5 py-2.5 text-sm font-semibold transition ${
                    statusFilter === "inactive"
                      ? "border-[#1d76c2] bg-[#1d76c2] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Inactive Students
                </button>
              </div>
              {statusFilter === "inactive" ? (
                <div className="mt-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { value: "all", label: "All inactive" },
                        { value: "temporary", label: "Temporary" },
                        { value: "graduated", label: "Graduated / permanent" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setInactiveKind(opt.value)}
                        className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                          inactiveKind === opt.value
                            ? "border-slate-700 bg-slate-700 text-white"
                            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Temporary = has Expected return. Graduated / permanent = no Return (incl. F.6). Add Return on
                    Lessons → Inactive history if they come back.
                  </p>
                </div>
              ) : null}
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
                {portalNotice ? (
                  <p className="mt-2 text-xs font-medium text-[#1d76c2]">{portalNotice}</p>
                ) : null}
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
              id={tableScrollId}
              className="max-h-[70vh] flex-1 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <ClientOnlyAfterMount fallback={<StudentsTableSkeleton />}>
              <table className={`divide-y divide-slate-200 ${isAdmin ? "min-w-[1780px]" : "min-w-[1500px]"}`}>
                <thead className="bg-slate-50">
                  <tr className="divide-x divide-slate-200">
                    <th className="sticky left-0 top-0 z-50 w-[64px] whitespace-nowrap bg-slate-50 px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
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
                      thClassName="left-[64px] z-40 min-w-[170px] max-w-[170px] bg-slate-50"
                    />
                    <SortableHeader
                      label="Chinese name"
                      columnKey="nameZh"
                      sortConfig={sortConfig}
                      setSortConfig={setSortConfig}
                      thClassName="left-[234px] z-40 min-w-[240px] max-w-[240px] bg-slate-50"
                    />
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
                    {isAdmin ? (
                      <th className="sticky top-0 z-30 min-w-[220px] whitespace-nowrap bg-slate-50 px-4 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
                        Portal
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedStudents.map((student) => {
                    const studentIdDisplay = normalizeStudentId(student.id);
                    const portalStatus = portalStatusById[studentIdDisplay];
                    const portalBusy = portalBusyId === studentIdDisplay;
                    const emailMismatch =
                      portalStatus?.hasAccount &&
                      !portalStatus.studentIdLoginOnly &&
                      portalStatus.authEmail &&
                      portalStatus.authEmail !== student.email.trim().toLowerCase();
                    return (
                      <tr
                        key={student.id}
                        className="group divide-x divide-slate-100 bg-white hover:bg-slate-50"
                      >
                        <td className="sticky left-0 z-30 w-[64px] whitespace-nowrap bg-white px-4 py-4 text-sm text-slate-700 group-hover:bg-slate-50">
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
                        <td className="sticky left-[64px] z-30 min-w-[170px] max-w-[170px] whitespace-nowrap bg-white px-6 py-4 text-sm font-medium text-slate-900 group-hover:bg-slate-50">
                          <Link
                            href={`/students/${encodeURIComponent(studentIdDisplay)}/lessons`}
                            className="text-[#1d76c2] hover:underline"
                          >
                            {studentIdDisplay}
                          </Link>
                        </td>
                        <td className="sticky left-[234px] z-30 min-w-[240px] max-w-[240px] whitespace-nowrap bg-white px-6 py-4 text-sm text-slate-700 group-hover:bg-slate-50">
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
                        {isAdmin ? (
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                            {!portalStatus ? (
                              <span className="text-slate-400">…</span>
                            ) : portalStatus.hasAccount ? (
                              <div className="flex flex-col gap-1.5">
                                <span
                                  className={
                                    portalStatus.loginAllowed
                                      ? "font-semibold text-emerald-700"
                                      : "font-semibold text-amber-700"
                                  }
                                >
                                  {portalStatus.loginAllowed ? "已開通" : "已開通（停用）"}
                                </span>
                                {!portalStatus.loginAllowed && portalStatus.reactivateDate ? (
                                  <span className="text-[11px] text-slate-500">
                                    可再開：{portalStatus.reactivateDate}
                                  </span>
                                ) : null}
                                {portalStatus.studentIdLoginOnly ? (
                                  <span className="text-[11px] text-slate-500">請用學生號碼登入</span>
                                ) : null}
                                {emailMismatch ? (
                                  <span className="text-[11px] text-amber-700">登入電郵不同步</span>
                                ) : null}
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    disabled={portalBusy}
                                    onClick={() => void runPortalAction(studentIdDisplay, "reset-password")}
                                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    重設密碼
                                  </button>
                                  {emailMismatch ? (
                                    <button
                                      type="button"
                                      disabled={portalBusy}
                                      onClick={() => void runPortalAction(studentIdDisplay, "sync-email")}
                                      className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      同步電郵
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                <span className="font-semibold text-slate-500">未開通</span>
                                {!portalStatus.ready && portalStatus.readyReason ? (
                                  <span className="text-[11px] text-red-600">{portalStatus.readyReason}</span>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={portalBusy || !portalStatus.ready}
                                  onClick={() => void runPortalAction(studentIdDisplay, "provision")}
                                  className="rounded border border-[#1d76c2]/30 bg-[#1d76c2]/5 px-2 py-0.5 font-semibold text-[#1d76c2] hover:bg-[#1d76c2]/10 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  開 Portal 帳號
                                </button>
                              </div>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </ClientOnlyAfterMount>
            </div>

            {sideScrollHeight > sideScrollClientHeight ? (
              <div className="border-l border-slate-200 bg-slate-50 px-2 py-2">
                <div
                  ref={sideTrackRef}
                  {...sideTrackA11yProps}
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
              <div
                ref={bottomTrackRef}
                {...bottomTrackA11yProps}
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
              {students.length === 0 && !query.trim()
                ? "No student records yet. Add one using the form above."
                : `No students found matching "${query}".`}
            </div>
          ) : null}

          {!isLoading && sortedStudents.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
              <p className="text-sm text-slate-600">
                {showAllStudents ? (
                  <>Showing all {sortedStudents.length} students</>
                ) : (
                  <>
                    Showing {(currentPage - 1) * STUDENTS_PAGE_SIZE + 1}–
                    {Math.min(currentPage * STUDENTS_PAGE_SIZE, listTotal || sortedStudents.length)} of{" "}
                    {listTotal || sortedStudents.length} students
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {showAllStudents ? (
                  <button
                    type="button"
                    disabled={pageLoading}
                    onClick={() => void fetchStudentsPage({ page: 1, showAll: false })}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Back to pages
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={pageLoading || listTotal <= STUDENTS_PAGE_SIZE}
                      onClick={() => void fetchStudentsPage({ showAll: true })}
                      className="rounded-md border border-[#1d76c2]/30 bg-[#1d76c2]/5 px-3 py-1.5 text-sm font-semibold text-[#1d76c2] hover:bg-[#1d76c2]/10 disabled:opacity-60"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      disabled={pageLoading || currentPage <= 1}
                      onClick={() => void fetchStudentsPage({ page: currentPage - 1 })}
                      aria-label="Previous page"
                      className="min-w-[2rem] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      &lt;
                    </button>
                    <div className="flex flex-wrap items-center gap-1">
                      {pageNumberItems.map((page) => {
                        const disabled = page > totalPages;
                        return (
                          <button
                            key={page}
                            type="button"
                            disabled={pageLoading || disabled}
                            onClick={() => void fetchStudentsPage({ page })}
                            className={`min-w-[2rem] rounded-md border px-2 py-1.5 text-sm font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                              page === currentPage
                                ? "border-[#1d76c2] bg-[#1d76c2] text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={pageLoading || currentPage >= totalPages}
                      onClick={() => void fetchStudentsPage({ page: currentPage + 1 })}
                      aria-label="Next page"
                      className="min-w-[2rem] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      &gt;
                    </button>
                  </>
                )}
              </div>
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

      {duplicateEmailPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">共用 Email — 只用學生號碼登入？</h2>
            <p className="mt-2 text-sm text-slate-600">
              Email <span className="font-semibold text-slate-900">{duplicateEmailPrompt.email}</span>{" "}
              已被學生{" "}
              <span className="font-semibold text-slate-900">{duplicateEmailPrompt.otherStudentId}</span>{" "}
              使用。
            </p>
            <p className="mt-2 text-sm text-slate-600">
              是否為此學生開 Portal，並<strong>只用學生號碼</strong>登入（密碼仍為聯絡電話；不能用此
              Email 登入）？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDuplicateEmailPrompt(null);
                  setFormError(
                    `Cancelled — email is shared with student ${duplicateEmailPrompt.otherStudentId}. Use a unique email, or confirm student-ID Portal login.`,
                  );
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingForm || portalBusyId !== null}
                onClick={confirmDuplicateEmailStudentIdPortal}
                className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#165f9d] disabled:opacity-60"
              >
                是，只用學生號碼
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StudentsTableSkeleton() {
  return (
    <table className="min-w-[1500px] divide-y divide-slate-200" aria-hidden>
      <thead className="bg-slate-50">
        <tr className="divide-x divide-slate-200">
          {Array.from({ length: 12 }, (_, i) => (
            <th key={i} className="px-4 py-3">
              <div className="h-4 w-12 rounded bg-slate-200" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {Array.from({ length: 10 }, (_, ri) => (
          <tr key={ri} className="divide-x divide-slate-100">
            {Array.from({ length: 12 }, (_, ci) => (
              <td key={ci} className="px-6 py-4">
                <div className="h-4 max-w-[140px] rounded bg-slate-100" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type InputFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "email" | "select";
  options?: string[];
  hint?: string;
};

function InputFieldControlFallback({ label }: { label: string }) {
  return (
    <>
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <div
        className="h-[42px] w-full rounded-lg border border-slate-300 bg-slate-50"
        aria-hidden
      />
    </>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  options = [],
  hint,
}: InputFieldProps) {
  const controlFallback = <InputFieldControlFallback label={label} />;
  const hintEl = hint ? <p className="mt-1 text-[11px] leading-4 text-slate-500">{hint}</p> : null;

  if (type === "select") {
    return (
      <label className="block">
        <ClientOnlyAfterMount fallback={controlFallback}>
          <>
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
            {hintEl}
          </>
        </ClientOnlyAfterMount>
      </label>
    );
  }

  return (
    <label className="block">
      <ClientOnlyAfterMount fallback={controlFallback}>
        <>
          <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
          <input
            type={type}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
          />
          {hintEl}
        </>
      </ClientOnlyAfterMount>
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

function isDuplicateStudentIdError(error: { code?: string; message?: string }): boolean {
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "23505" || message.includes("duplicate key") || message.includes("students_pkey");
}

type CredentialCheckResult =
  | { ok: true }
  | { ok: false; duplicateEmail: false; error: string }
  | {
      ok: false;
      duplicateEmail: true;
      otherStudentId: string;
      email: string;
      error: string;
    };

async function validateStudentCredentialsForSave(
  form: StudentForm,
  excludeStudentId?: string,
): Promise<CredentialCheckResult> {
  const phone = validateStudentContactPhone(form.studentPhone);
  if (!phone.ok) return { ok: false, duplicateEmail: false, error: phone.error };
  const email = validateStudentEmailFormat(form.email);
  if (!email.ok) return { ok: false, duplicateEmail: false, error: email.error };

  // Editing: keep legacy shared emails if unchanged (special sibling cases).
  if (excludeStudentId) {
    const { data: current, error: currentError } = await supabase
      .from("students")
      .select("email")
      .eq("id", excludeStudentId)
      .maybeSingle();
    if (currentError) {
      return {
        ok: false,
        duplicateEmail: false,
        error: `Failed to check email uniqueness: ${currentError.message}`,
      };
    }
    const currentEmail = String(current?.email ?? "")
      .trim()
      .toLowerCase();
    if (currentEmail && currentEmail === email.value) {
      return { ok: true };
    }
  }

  let query = supabase.from("students").select("id").ilike("email", email.value).limit(1);
  if (excludeStudentId) {
    query = query.neq("id", excludeStudentId);
  }
  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      duplicateEmail: false,
      error: `Failed to check email uniqueness: ${error.message}`,
    };
  }
  if (data?.length) {
    const otherId = normalizeStudentId(String(data[0]?.id ?? ""));
    return {
      ok: false,
      duplicateEmail: true,
      otherStudentId: otherId || "?",
      email: email.value,
      error: `Email is already used by student ${otherId || "(another record)"}.`,
    };
  }
  return { ok: true };
}

async function provisionPortalAfterCreate(
  studentId: string,
  options?: { studentIdLoginOnly?: boolean },
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/portal-account`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provision",
        studentIdLoginOnly: options?.studentIdLoginOnly === true,
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      result?: { message?: string };
    };
    if (!res.ok || !body.ok) {
      return { ok: false, message: body.error ?? "Failed to open portal account." };
    }
    return { ok: true, message: body.result?.message ?? "Portal account opened." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to open portal account." };
  }
}

async function fetchNextStudentIdFromDb(): Promise<string> {
  const res = await fetch("/api/students/next-id", { credentials: "same-origin" });
  const body = (await res.json()) as { ok?: boolean; nextId?: string; error?: string };
  if (!res.ok || !body.ok || !body.nextId) {
    throw new Error(body.error ?? "Failed to fetch next student id");
  }
  return body.nextId;
}

function mapRowToStudent(row: StudentRow): Student {
  const birthDate = row.birth_date ?? "";
  const parsedBirthTs = Date.parse(birthDate);
  const base = {
    id: row.id,
    nameZh: row.name_zh ?? "",
    nameEn: row.name_en ?? "",
    nicknameEn: row.nickname_en ?? "",
    birthDate,
    studentPhone: row.student_phone ?? "",
    email: row.email ?? "",
    school: row.school ?? "",
    textbookPublisher: row.textbook_publisher ?? "",
    grade: normalizeGradeCode(row.grade),
    mathLanguage: row.math_language ?? "English",
    birthTs: Number.isFinite(parsedBirthTs) ? parsedBirthTs : Number.MAX_SAFE_INTEGER,
  };
  return { ...base, searchBlob: buildStudentSearchBlob(base) };
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
