import type { ProgressSelectionMap } from "@/lib/studentProgressSelections";
import { PU_SHEET } from "@/lib/studentProgressWorkbook";

export type PuNoteEntry = {
  date: string;
  note: string;
};

const PU_ENTRY_PREFIX = `${PU_SHEET}::entry::`;
export const PU_MIN_VISIBLE_ROWS = 8;

export function buildPuEntryDateKey(index: number): string {
  return `${PU_ENTRY_PREFIX}${index}::date`;
}

export function buildPuEntryNoteKey(index: number): string {
  return `${PU_ENTRY_PREFIX}${index}::note`;
}

export function listPuEntriesFromSelections(selections: ProgressSelectionMap): PuNoteEntry[] {
  const indexes = new Set<number>();
  for (const key of Object.keys(selections)) {
    if (!key.startsWith(PU_ENTRY_PREFIX)) continue;
    const rest = key.slice(PU_ENTRY_PREFIX.length);
    const indexText = rest.split("::")[0] ?? "";
    const index = Number.parseInt(indexText, 10);
    if (Number.isFinite(index) && index >= 0) indexes.add(index);
  }
  const maxIndex = indexes.size ? Math.max(...indexes) : -1;
  const out: PuNoteEntry[] = [];
  for (let i = 0; i <= maxIndex; i += 1) {
    out.push({
      date: String(selections[buildPuEntryDateKey(i)] ?? "").trim(),
      note: String(selections[buildPuEntryNoteKey(i)] ?? ""),
    });
  }
  return out;
}

/** Keep filled rows + trailing blanks so the sheet feels like Excel. */
export function visiblePuEntryCount(selections: ProgressSelectionMap, minRows = PU_MIN_VISIBLE_ROWS): number {
  const entries = listPuEntriesFromSelections(selections);
  let lastFilled = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]?.date || entries[i]?.note.trim()) lastFilled = i;
  }
  return Math.max(minRows, lastFilled + 2);
}

export function getPuEntryAt(
  selections: ProgressSelectionMap,
  index: number,
): PuNoteEntry {
  return {
    date: String(selections[buildPuEntryDateKey(index)] ?? "").trim(),
    note: String(selections[buildPuEntryNoteKey(index)] ?? ""),
  };
}

export function patchPuEntryField(
  selections: ProgressSelectionMap,
  index: number,
  field: "date" | "note",
  value: string,
): ProgressSelectionMap {
  const key = field === "date" ? buildPuEntryDateKey(index) : buildPuEntryNoteKey(index);
  const next = { ...selections };
  const trimmed = field === "date" ? value.trim() : value;
  if (!trimmed) {
    delete next[key];
  } else {
    next[key] = trimmed;
  }
  return next;
}

export function isPuSelectionKey(key: string): boolean {
  return key.startsWith(PU_ENTRY_PREFIX);
}

export function pickPuSelections(selections: ProgressSelectionMap): ProgressSelectionMap {
  const out: ProgressSelectionMap = {};
  for (const [key, value] of Object.entries(selections)) {
    if (isPuSelectionKey(key)) out[key] = value;
  }
  return out;
}

export function stripPuSelections(selections: ProgressSelectionMap): ProgressSelectionMap {
  const out: ProgressSelectionMap = {};
  for (const [key, value] of Object.entries(selections)) {
    if (!isPuSelectionKey(key)) out[key] = value;
  }
  return out;
}

/** Non-admins may save other progress cells, but must not overwrite PU notes. */
export function mergePreservingPuSelections(
  incoming: ProgressSelectionMap,
  existing: ProgressSelectionMap,
): ProgressSelectionMap {
  return { ...stripPuSelections(incoming), ...pickPuSelections(existing) };
}
