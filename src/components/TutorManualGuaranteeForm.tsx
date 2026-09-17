"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ROOM_SLOT_TIME_SUGGESTIONS } from "@/lib/roomSlotTutorRules";

type TutorOption = {
  id: string;
  displayName: string;
};

type Props = {
  tutors: TutorOption[];
};

export default function TutorManualGuaranteeForm({ tutors }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tutorId, setTutorId] = useState("");
  const [dateIso, setDateIso] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const timeListId = useMemo(() => "tutor-manual-guarantee-times", []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/tutor-manual-guarantees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, dateIso, time }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; row?: { dateIso: string } };
      if (!res.ok || !data.ok) {
        setStatus(data.error || "Failed to add");
        return;
      }
      setStatus("Added");
      setDateIso("");
      setTime("");
      const y = (data.row?.dateIso ?? dateIso).slice(0, 4);
      const m = (data.row?.dateIso ?? dateIso).slice(5, 7);
      router.push(
        `/tutor-monthly-lesson-record/${encodeURIComponent(tutorId)}?year=${y}&month=${Number(m)}`,
      );
      router.refresh();
    } catch {
      setStatus("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Add manual guarantee</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Enter date, time, and Tutor only. Creates a 0·Single manual guarantee counted in that
            month&apos;s payroll. Same date + time + Tutor cannot be added twice.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1663a3]"
        >
          {open ? "Close" : "+ Add guarantee"}
        </button>
      </div>

      {open ? (
        <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Date
            <input
              type="date"
              required
              value={dateIso}
              onChange={(e) => setDateIso(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Time
            <input
              type="text"
              required
              list={timeListId}
              placeholder="e.g. 04:30 PM"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-36 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
            />
            <datalist id={timeListId}>
              {ROOM_SLOT_TIME_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-slate-600">
            Tutor
            <select
              required
              value={tutorId}
              onChange={(e) => setTutorId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-[#1d76c2] focus:ring-2 focus:ring-[#1d76c2]/25"
            >
              <option value="">Select tutor</option>
              {tutors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName} ({t.id})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#1d76c2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1663a3] disabled:opacity-50"
          >
            {saving ? "…" : "Add"}
          </button>
          {status ? (
            <span
              className={`text-xs ${status === "Added" ? "text-emerald-700" : "text-rose-700"}`}
            >
              {status}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
