"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AppTopNav from "@/components/AppTopNav";
import { normalizeStudentId } from "@/lib/studentId";

type Student = {
  id: string;
  nameZh: string;
  nameEn: string;
  nicknameEn: string;
  birthDate: string;
  studentPhone: string;
  email: string;
  school: string;
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
  grade: string | null;
  math_language: string | null;
};

const PRIMARY_GRADIENT = "linear-gradient(to right, #1d76c2 0%, #1d76c2 100%)";

type StudentForm = Omit<Student, "id">;

const emptyForm: StudentForm = {
  nameZh: "",
  nameEn: "",
  nicknameEn: "",
  birthDate: "",
  studentPhone: "",
  email: "",
  school: "",
  grade: "",
  mathLanguage: "英文",
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return students;
    }

    return students.filter((student) => {
      return (
        student.id.toLowerCase().includes(keyword) ||
        normalizeStudentId(student.id).toLowerCase().includes(keyword) ||
        student.nameZh.toLowerCase().includes(keyword) ||
        student.nameEn.toLowerCase().includes(keyword) ||
        student.nicknameEn.toLowerCase().includes(keyword)
      );
    });
  }, [query, students]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const sortedStudents = useMemo(() => {
    const copied = [...filteredStudents];
    const gradeOrder: Record<string, number> = {
      中一: 1,
      中二: 2,
      中三: 3,
      中四: 4,
      中五: 5,
      中六: 6,
    };

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
        result =
          (gradeOrder[a.grade] ?? Number.MAX_SAFE_INTEGER) -
          (gradeOrder[b.grade] ?? Number.MAX_SAFE_INTEGER);
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
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      setDataError("讀取學生資料失敗，請確認 Supabase 設定與資料表。");
      setIsLoading(false);
      return;
    }

    const mapped = (data as StudentRow[]).map(mapRowToStudent);
    setStudents(mapped);
    setSelectedIds((prev) => {
      const mappedIdSet = new Set(mapped.map((student) => student.id));
      return prev.filter((id) => mappedIdSet.has(id));
    });
    setIsLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const onFieldChange = (field: keyof StudentForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveStudent = () => {
    void saveStudentAsync();
  };

  const saveStudentAsync = async () => {
    setFormError("");

    if (editingId) {
      const { error } = await supabase
        .from("students")
        .update(mapFormToRow(form))
        .eq("id", editingId);

      if (error) {
      setFormError(`儲存編輯失敗：${error.message}`);
        return;
      }

      await loadStudents();
      setEditingId(null);
      setForm(emptyForm);
      setSelectedIds([]);
      return;
    }

    const { error } = await supabase
      .from("students")
      .insert([{ id: nextStudentId, ...mapFormToRow(form) }]);

    if (error) {
      setFormError(`新增學生失敗：${error.message}`);
      return;
    }

    await loadStudents();
    setForm(emptyForm);
  };

  const startEditSelected = () => {
    if (selectedIds.length !== 1) {
      setSelectionError("請先只勾選 1 位學生再編輯。");
      return;
    }

    const target = studentById.get(selectedIds[0]);
    if (!target) {
      setSelectionError("找不到要編輯的學生資料。");
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
      grade: target.grade,
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

    const { error } = await supabase.from("students").delete().in("id", selectedIds);
    if (error) {
      setSelectionError("刪除失敗，請稍後重試。");
      setShowDeleteConfirm(false);
      return;
    }

    await loadStudents();
    setSelectedIds([]);
    setSelectionError("");
    setShowDeleteConfirm(false);
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
            <h1 className="text-2xl font-bold tracking-tight">All Student Info</h1>
            <p className="mt-1 text-sm text-blue-100">
              填寫下方表單即可新增學生資料（單筆錄入）。
            </p>
            <p className="mt-1 text-xs text-blue-100/90">
              系統學號：{editingId ?? nextStudentId}（自動編號，從 00001 開始）
            </p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InputField
                label="學生姓名(中)"
                value={form.nameZh}
                onChange={(v) => onFieldChange("nameZh", v)}
              />
              <InputField
                label="學生姓名(英)"
                value={form.nameEn}
                onChange={(v) => onFieldChange("nameEn", v)}
              />
              <InputField
                label="暱稱/英文名"
                value={form.nicknameEn}
                onChange={(v) => onFieldChange("nicknameEn", v)}
              />
              <InputField
                label="出生日期"
                type="date"
                value={form.birthDate}
                onChange={(v) => onFieldChange("birthDate", v)}
              />
              <InputField
                label="聯絡電話"
                value={form.studentPhone}
                onChange={(v) => onFieldChange("studentPhone", v)}
              />
              <InputField
                label="電子郵件"
                type="email"
                value={form.email}
                onChange={(v) => onFieldChange("email", v)}
              />
              <InputField
                label="就讀學校"
                value={form.school}
                onChange={(v) => onFieldChange("school", v)}
              />
              <InputField
                label="就讀年級"
                value={form.grade}
                onChange={(v) => onFieldChange("grade", v)}
                type="select"
                options={["中一", "中二", "中三", "中四", "中五", "中六"]}
              />
              <fieldset className="block">
                <legend className="mb-1 block text-sm font-semibold text-slate-700">
                  學校教授數學語言
                </legend>
                <div className="flex h-[42px] items-center gap-6 rounded-lg border border-slate-300 bg-white px-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="radio"
                      name="mathLanguage"
                      value="中文"
                      checked={form.mathLanguage === "中文"}
                      onChange={(event) => onFieldChange("mathLanguage", event.target.value)}
                      className="h-4 w-4 accent-[#1d76c2]"
                    />
                    中文
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="radio"
                      name="mathLanguage"
                      value="英文"
                      checked={form.mathLanguage === "英文"}
                      onChange={(event) => onFieldChange("mathLanguage", event.target.value)}
                      className="h-4 w-4 accent-[#1d76c2]"
                    />
                    英文
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveStudent}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundImage: PRIMARY_GRADIENT }}
              >
                {editingId ? "儲存編輯" : "新增學生"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm);
                    setFormError("");
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  取消編輯
                </button>
              )}
            </div>
            {formError && (
              <p className="mt-2 text-sm font-medium text-red-600">{formError}</p>
            )}
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label
                htmlFor="student-search"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                按學號 / 中文名 / 英文名 / 暱稱搜尋
              </label>
              <input
                id="student-search"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：00001、王小明、Tom"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none ring-0 transition focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
              />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div>
                已選取：<span className="font-semibold text-slate-900">{selectedIds.length}</span> 位學生
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startEditSelected}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  編輯
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                >
                  刪除
                </button>
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

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="bm-freeze-table min-w-[1500px] divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="divide-x divide-slate-200">
                  <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
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
                  <SortableHeader label="學號" columnKey="id" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="學生姓名(中)" columnKey="nameZh" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="學生姓名(英)" columnKey="nameEn" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="暱稱/英文名" columnKey="nicknameEn" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="出生日期" columnKey="birthDate" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="聯絡電話" columnKey="studentPhone" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="電子郵件" columnKey="email" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="就讀學校" columnKey="school" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="就讀年級" columnKey="grade" sortConfig={sortConfig} setSortConfig={setSortConfig} />
                  <SortableHeader label="學校教授數學語言" columnKey="mathLanguage" sortConfig={sortConfig} setSortConfig={setSortConfig} />
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
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        {student.nameEn}
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
                        {student.grade}
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

          {isLoading ? (
            <div className="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">
              讀取學生資料中...
            </div>
          ) : sortedStudents.length === 0 ? (
            <div className="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">
              {students.length === 0
                ? "目前沒有學生資料，請先在上方表單新增。"
                : `找不到符合 "${query}" 的學生。`}
            </div>
          ) : null}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">確認刪除</h2>
            <p className="mt-2 text-sm text-slate-600">
              你確定要刪除已選取的 {selectedIds.length} 位學生資料嗎？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={deleteSelectedStudents}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                刪除
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
          <option value="">請選擇</option>
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
};

function SortableHeader({ label, columnKey, sortConfig, setSortConfig }: SortableHeaderProps) {
  const selectedDirection = sortConfig?.key === columnKey ? sortConfig.direction : "";

  return (
    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-bold tracking-wider text-slate-700">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="whitespace-nowrap">{label}</span>
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
    grade: row.grade ?? "",
    mathLanguage: row.math_language ?? "英文",
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
  const grade = form.grade.trim();
  const mathLanguage = form.mathLanguage.trim();
  return {
    name_zh: nameZh ? nameZh : null,
    name_en: nameEn ? nameEn : null,
    nickname_en: nicknameEn ? nicknameEn : null,
    birth_date: birthDate ? birthDate : null,
    student_phone: studentPhone ? studentPhone : null,
    email: email ? email : null,
    school: school ? school : null,
    grade: grade ? grade : null,
    math_language: mathLanguage ? mathLanguage : null,
  };
}
