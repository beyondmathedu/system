"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import {
  getNextClassroomId,
  normalizeClassroomSlug,
  propagateClassroomNameChange,
  suggestSlugFromDisplayName,
} from "@/lib/roomNamePropagation";
import { FALLBACK_ROOM_NAV_LINKS } from "@/lib/roomConstants";
import { supabase } from "@/lib/supabase";

type Classroom = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  regular_period_max: number | null;
};

function dispatchClassroomsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("beyondmath:classrooms-updated"));
  }
}

export default function RoomsIndexPage() {
  const [rows, setRows] = useState<Classroom[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<{ name: string } | null>(null);

  const [roomName, setRoomName] = useState("");
  const [roomSlug, setRoomSlug] = useState("");
  const [roomDesc, setRoomDesc] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  /** 恆常班每時段人數上限；空白表示用系統預設 */
  const [regularPeriodMax, setRegularPeriodMax] = useState("");

  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadClassrooms = useCallback(async (): Promise<Classroom[] | null> => {
    const { data, error } = await supabase
      .from("classrooms")
      .select("id, name, slug, description, sort_order, regular_period_max")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      setLoadError(error.message);
      setRows([]);
      setIsLoading(false);
      return null;
    }
    setLoadError("");
    const mapped = (data ?? []).map((r) => {
      const row = r as Classroom;
      const rpm = row.regular_period_max;
      const rpmN = rpm == null ? null : Number(rpm);
      return {
        id: String(row.id),
        name: String(row.name ?? "").trim(),
        slug: String(row.slug ?? "").trim().toLowerCase(),
        description: String(row.description ?? "").trim(),
        sort_order: Number(row.sort_order) || 0,
        regular_period_max:
          rpmN != null && Number.isFinite(rpmN) && rpmN > 0 ? Math.floor(rpmN) : null,
      };
    });
    setRows(mapped);
    setIsLoading(false);
    return mapped;
  }, []);

  useEffect(() => {
    const run = () => {
      void loadClassrooms();
    };
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, [loadClassrooms]);

  const nextId = useMemo(() => getNextClassroomId(rows), [rows]);

  const nextSortFromList = useCallback((list: Classroom[]) => {
    if (list.length === 0) return 1;
    return Math.max(...list.map((r) => r.sort_order), 0) + 1;
  }, []);

  const nextSortDefault = useMemo(() => nextSortFromList(rows), [rows, nextSortFromList]);

  const displayLinks = useMemo(() => {
    if (rows.length > 0) {
      return rows.map((r) => ({
        href: `/rooms/${encodeURIComponent(r.slug)}`,
        title: `${r.id} ${r.name}`,
        subtitle: r.description || `前往 ${r.name} 的月度排課汇总`,
      }));
    }
    return FALLBACK_ROOM_NAV_LINKS.map((r) => ({
      href: r.href,
      title: r.label,
      subtitle: "預設房間（尚未建立 classrooms 表或尚無資料時使用）",
    }));
  }, [rows]);

  function resetFormAfterSave(freshRows: Classroom[]) {
    setEditingId(null);
    setEditSnapshot(null);
    setRoomName("");
    setRoomSlug("");
    setRoomDesc("");
    setSortOrder(String(nextSortFromList(freshRows)));
    setRegularPeriodMax("");
    setFormError("");
  }

  function resetForm() {
    setEditingId(null);
    setEditSnapshot(null);
    setRoomName("");
    setRoomSlug("");
    setRoomDesc("");
    setSortOrder(String(nextSortDefault));
    setRegularPeriodMax("");
    setFormError("");
    setFormNotice("");
  }

  function startEdit(r: Classroom) {
    setFormError("");
    setFormNotice("");
    setEditingId(r.id);
    setEditSnapshot({ name: r.name });
    setRoomName(r.name);
    setRoomSlug(r.slug);
    setRoomDesc(r.description);
    setSortOrder(String(r.sort_order));
    setRegularPeriodMax(
      r.regular_period_max != null && r.regular_period_max > 0 ? String(r.regular_period_max) : "",
    );
  }

  async function onSubmit() {
    const name = roomName.trim();
    const slugNorm = normalizeClassroomSlug(roomSlug);
    const desc = roomDesc.trim();
    const sortN = Math.floor(Number(sortOrder));

    if (!name) {
      setFormError("請輸入房間名稱（須與學生課表內教室欄位一致，篩選才會命中）。");
      return;
    }
    if (!slugNorm) {
      setFormError("URL 代碼（slug）須為小寫英數與連字，例如 hope、hope-2。");
      return;
    }
    if (!Number.isFinite(sortN)) {
      setFormError("排序請填有效整數。");
      return;
    }

    const rpmRaw = regularPeriodMax.trim();
    let regular_period_max: number | null = null;
    if (rpmRaw !== "") {
      const n = Math.floor(Number(rpmRaw));
      if (!Number.isFinite(n) || n < 1 || n > 99) {
        setFormError("恆常每時段上限請填 1–99 的整數，或留空以使用系統預設。");
        return;
      }
      regular_period_max = n;
    }

    setFormError("");
    setFormNotice("");
    setIsSaving(true);

    if (editingId) {
      const nameChanged = editSnapshot && editSnapshot.name !== name;

      if (nameChanged) {
        const prop = await propagateClassroomNameChange(editSnapshot!.name, name);
        if (!prop.ok) {
          setIsSaving(false);
          setFormError(`同步課表教室名稱失敗：${prop.error ?? "未知錯誤"}（未更新房間資料）`);
          return;
        }
        if (
          prop.stats.lessonRecordRows +
            prop.stats.lessons2026Rows +
            prop.stats.lessonsYearRows >
          0
        ) {
          setFormNotice(
            `已將課表內「${editSnapshot!.name}」改為「${name}」：lesson_records ${prop.stats.lessonRecordRows} 筆、2026 state ${prop.stats.lessons2026Rows} 筆、年度 state ${prop.stats.lessonsYearRows} 筆。`,
          );
        }
      }

      const { error: upErr } = await supabase
        .from("classrooms")
        .update({
          name,
          slug: slugNorm,
          description: desc,
          sort_order: sortN,
          regular_period_max,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId);

      setIsSaving(false);
      if (upErr) {
        setFormError(`儲存失敗：${upErr.message}`);
        return;
      }

      const fresh = await loadClassrooms();
      if (fresh) resetFormAfterSave(fresh);
      else resetForm();
      dispatchClassroomsUpdated();
      return;
    }

    const { error: insErr } = await supabase.from("classrooms").insert([
      {
        id: nextId,
        name,
        slug: slugNorm,
        description: desc,
        sort_order: sortN,
        regular_period_max,
        updated_at: new Date().toISOString(),
      },
    ]);

    setIsSaving(false);
    if (insErr) {
      setFormError(`新增失敗：${insErr.message}`);
      return;
    }

    const fresh = await loadClassrooms();
    if (fresh) resetFormAfterSave(fresh);
    else resetForm();
    dispatchClassroomsUpdated();
  }

  function onRoomNameBlur() {
    if (editingId) return;
    if (roomSlug.trim()) return;
    const s = suggestSlugFromDisplayName(roomName);
    if (s) setRoomSlug(s);
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="room" />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">Room</h1>
            <p className="mt-1 text-sm text-blue-100">
              在此新增或修改房間：每個 slug 對應一個頁面 <span className="font-mono">/rooms/你的代碼</span>
              。修改「房間名稱」會一併更新所有學生課表與補堂／加堂裡相同的教室字串。
            </p>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <h2 className="text-sm font-bold text-slate-800">房間資料</h2>
            <p className="mt-1 text-xs text-slate-600">
              房間名稱須與課表 JSON 的 room 欄位完全一致；若只改 URL 代碼（slug）不會改動課表內文。
              恆常每時段上限用於「恆常班時間表」餘額列；空白則依房名套用預設（B、M前 5；M後、Hope 6；Hope 2
              為 5）。
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[100px_minmax(0,1.2fr)_minmax(0,1fr)_88px_auto] md:items-end">
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-700">ID</p>
                <p className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800">
                  {editingId ?? nextId}
                </p>
              </div>
              <label className="block min-w-0">
                <span className="mb-1 block text-sm font-semibold text-slate-700">房間名稱</span>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  onBlur={onRoomNameBlur}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                  placeholder="例如：Hope 2（與課表 room 一致）"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-sm font-semibold text-slate-700">URL 代碼 (slug)</span>
                <input
                  type="text"
                  value={roomSlug}
                  onChange={(e) => setRoomSlug(e.target.value.toLowerCase())}
                  disabled={Boolean(editingId)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  placeholder="hope-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">排序</span>
                <input
                  type="number"
                  step={1}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onSubmit()}
                  disabled={isSaving}
                  className="h-10 rounded-lg bg-[#1d76c2] px-4 text-sm font-semibold text-white hover:bg-[#1663a3] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editingId ? "儲存變更" : "新增房間"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    取消
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRoomSlug("");
                      setSortOrder(String(nextSortDefault));
                    }}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    重設 slug／排序
                  </button>
                )}
              </div>
            </div>

            {editingId ? (
              <p className="mt-2 text-xs text-amber-800">
                已建立房間後無法修改 slug（避免舊連結錯亂）。若要新網址請新增一筆房間。
              </p>
            ) : null}

            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">簡述（選填）</span>
              <input
                type="text"
                value={roomDesc}
                onChange={(e) => setRoomDesc(e.target.value)}
                className="w-full max-w-3xl rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                placeholder="顯示在房間頁標題下方"
              />
            </label>

            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                恆常每時段上限（選填）
              </span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={regularPeriodMax}
                onChange={(e) => setRegularPeriodMax(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1d76c2] focus:shadow-[0_0_0_3px_rgba(29,118,194,0.15)]"
                placeholder="留空＝預設"
              />
              <span className="mt-1 block text-xs text-slate-500">1–99；用於 /regular-class-timetable 餘額</span>
            </label>

            {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}
            {formNotice ? <p className="mt-3 text-sm text-emerald-800">{formNotice}</p> : null}
          </div>

          {loadError ? (
            <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
              無法讀取 classrooms：{loadError}。請確認已執行{" "}
              <span className="font-mono">supabase/supabase_student_lessons_schema.sql</span>
              ；若錯誤提及 regular_period_max，請執行{" "}
              <span className="font-mono">supabase/supabase_classrooms_regular_period_max.sql</span>。
            </div>
          ) : null}

          <div className="p-6">
            {rows.length > 0 ? (
              <div className="mb-8 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">房間名稱</th>
                      <th className="px-4 py-3">slug</th>
                      <th className="px-4 py-3">恆常上限</th>
                      <th className="px-4 py-3">排序</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.id}</td>
                        <td className="px-4 py-3 text-slate-800">{r.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#1d76c2]">{r.slug}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                          {r.regular_period_max != null ? r.regular_period_max : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.sort_order}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            編輯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!isLoading && rows.length === 0 && !loadError ? (
              <p className="mb-6 text-sm text-slate-600">尚無房間資料，請先新增，或使用下方預設連結。</p>
            ) : null}
            {isLoading ? <p className="mb-6 text-sm text-slate-500">讀取房間資料中…</p> : null}

            <h3 className="mb-3 text-sm font-bold text-slate-800">進入房間頁面</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {displayLinks.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4 transition hover:border-[#1d76c2]/40 hover:bg-white hover:shadow-sm"
                  >
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.subtitle}</p>
                    <p className="mt-2 font-mono text-xs text-[#1d76c2]">{item.href}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
