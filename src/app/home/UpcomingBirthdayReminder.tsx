"use client";

import { useMemo, useState } from "react";

type ReminderItem = {
  id: string;
  dayLabel: string;
  dateLabel: string;
  personLabel: string;
};

export default function UpcomingBirthdayReminder({ items }: { items: ReminderItem[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(items.map((i) => i.id));

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.includes(i.id)),
    [items, selectedIds],
  );

  const message = useMemo(() => {
    if (!selectedItems.length) return "生日提醒";
    const lines = selectedItems.map((i) => `${i.dayLabel} ${i.dateLabel}，${i.personLabel}`);
    return ["生日", ...lines].join("\n");
  }, [selectedItems]);
  const whatsappHref = `https://wa.me/85251646814?text=${encodeURIComponent(message)}`;

  if (!items.length) {
    return <p className="text-sm text-slate-600">本週暫時冇生日提醒</p>;
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">可勾選後發送提醒</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">已選 {selectedItems.length} 位</span>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              selectedItems.length
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"
            }`}
          >
            WhatsApp 提醒 51646814
          </a>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds((prev) => [...prev, item.id]);
                else setSelectedIds((prev) => prev.filter((id) => id !== item.id));
              }}
              className="h-4 w-4 accent-[#1d76c2]"
            />
            <span>{`${item.dayLabel} ${item.dateLabel}，${item.personLabel}`}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

