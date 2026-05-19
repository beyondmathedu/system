"use client";

import { useMemo, useState } from "react";
import {
  findDuplicateScheduleRuleGroups,
  formatScheduleRuleSlotLabel,
  pruneDuplicateScheduleRules,
  scheduleSlotKey,
  type LessonScheduleSlotRule,
} from "@/lib/lessonScheduleVersions";

type Props<T extends LessonScheduleSlotRule> = {
  records: T[];
  onMerged: (next: T[]) => void;
  weekdayLabel?: (weekday: string) => string;
};

export default function ScheduleDuplicateRulesBanner<T extends LessonScheduleSlotRule>({
  records,
  onMerged,
  weekdayLabel,
}: Props<T>) {
  const groups = useMemo(() => findDuplicateScheduleRuleGroups(records), [records]);
  const [merging, setMerging] = useState(false);

  if (groups.length === 0) return null;

  const removeCount = groups.reduce((n, g) => n + g.remove.length, 0);

  return (
    <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-950">
      <p className="font-semibold">
        偵測到 {groups.length} 組重複課表（同 effective date、星期、時間、房間），列表暫以單堂顯示；資料庫仍有{" "}
        {removeCount} 條多餘規則。
      </p>
      <ul className="mt-2 max-h-36 space-y-2 overflow-y-auto text-[11px]">
        {groups.map((g) => (
          <li
            key={`${g.effectiveDate}|${scheduleSlotKey(g)}`}
            className="rounded border border-orange-200 bg-white/80 px-2 py-1.5"
          >
            <div className="font-medium">Effective {g.effectiveDate}</div>
            <div className="mt-0.5 text-orange-900">
              保留：{formatScheduleRuleSlotLabel(g.keep, weekdayLabel)}
            </div>
            {g.remove.map((r) => (
              <div key={r.id ?? scheduleSlotKey(r)} className="text-orange-800 line-through">
                刪除：{formatScheduleRuleSlotLabel(r, weekdayLabel)}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={merging}
        onClick={() => {
          const summary = groups
            .map(
              (g) =>
                `${g.effectiveDate}: 保留 ${formatScheduleRuleSlotLabel(g.keep, weekdayLabel)}，刪 ${g.remove.length} 條`,
            )
            .join("\n");
          if (
            !window.confirm(
              `合併重複課表並寫入雲端？\n\n${summary}\n\n（有導師的規則優先保留；出席記錄若綁在刪除的 rule id 上可能需要重新打勾）`,
            )
          ) {
            return;
          }
          setMerging(true);
          const { rules } = pruneDuplicateScheduleRules(records);
          onMerged(rules);
          setMerging(false);
        }}
        className="mt-2 rounded-md bg-orange-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {merging ? "合併中…" : "合併重複課表（寫入雲端）"}
      </button>
    </div>
  );
}
