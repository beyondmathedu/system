"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ROOM_SLOT_TIME_SUGGESTIONS } from "@/lib/roomSlotTutorRules";

type Props = {
  guaranteeId: string;
  tutorId: string;
  dateIso: string;
  time: string;
};

export default function TutorManualGuaranteeActions({
  guaranteeId,
  tutorId,
  dateIso: initialDateIso,
  time: initialTime,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dateIso, setDateIso] = useState(initialDateIso);
  const [time, setTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const timeListId = useMemo(() => `manual-guarantee-edit-${guaranteeId}`, [guaranteeId]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/tutor-manual-guarantees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: guaranteeId, tutorId, dateIso, time }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        row?: { dateIso: string; tutorId: string };
      };
      if (!res.ok || !data.ok) {
        setStatus(data.error || "儲存失敗");
        return;
      }
      setEditing(false);
      const nextDate = data.row?.dateIso ?? dateIso;
      const y = nextDate.slice(0, 4);
      const m = Number(nextDate.slice(5, 7));
      const nextTutor = data.row?.tutorId ?? tutorId;
      router.push(
        `/tutor-monthly-lesson-record/${encodeURIComponent(nextTutor)}?year=${y}&month=${m}`,
      );
      router.refresh();
    } catch {
      setStatus("網路錯誤");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm("刪除此 manual guarantee？")) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/tutor-manual-guarantees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: guaranteeId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error || "刪除失敗");
        return;
      }
      router.refresh();
    } catch {
      setStatus("網路錯誤");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={(e) => void onSave(e)}
        className="mt-1 flex flex-wrap items-end gap-2 text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="flex flex-col gap-0.5 text-amber-900">
          日期
          <input
            type="date"
            required
            value={dateIso}
            onChange={(e) => setDateIso(e.target.value)}
            className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-xs text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-amber-900">
          時間
          <input
            type="text"
            required
            list={timeListId}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-28 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-xs text-slate-900"
          />
          <datalist id={timeListId}>
            {ROOM_SLOT_TIME_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-[#1d76c2] px-2 py-0.5 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : "儲存"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDateIso(initialDateIso);
            setTime(initialTime);
            setStatus("");
          }}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700"
        >
          取消
        </button>
        {status ? <span className="text-rose-700">{status}</span> : null}
      </form>
    );
  }

  return (
    <span className="ml-2 inline-flex items-center gap-2 align-middle text-[11px]">
      <button
        type="button"
        disabled={busy}
        onClick={() => setEditing(true)}
        className="font-medium text-[#1d76c2] underline hover:text-[#1663a3] disabled:opacity-50"
      >
        編輯
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onDelete()}
        className="font-medium text-rose-700 underline hover:text-rose-900 disabled:opacity-50"
      >
        {busy ? "…" : "刪除"}
      </button>
      {status ? <span className="text-rose-700">{status}</span> : null}
    </span>
  );
}
