/** Per-date and per-slot lesson overrides in student year state `overrides` JSON. */

export type LessonDayOverride = {
  time?: string;
  room?: string;
  tutor?: string;
  lessonSummary?: string;
};

/** `slot:{id}:{YYYY-MM-DD}` — one lesson instance (regular rule / reschedule / extra). */
export const LESSON_OVERRIDE_SLOT_PREFIX = "slot:";
export const LESSON_OVERRIDE_RESCHEDULE_ID_PREFIX = "rs:";
export const LESSON_OVERRIDE_EXTRA_ID_PREFIX = "ex:";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_KEY_RE = /^slot:(.+):(\d{4}-\d{2}-\d{2})$/;

export function lessonOverrideSlotKey(scheduleRuleId: string, dateIso: string): string {
  return `${LESSON_OVERRIDE_SLOT_PREFIX}${String(scheduleRuleId).trim()}:${String(dateIso).trim()}`;
}

/** Synthetic override id for a Reschedule makeup row (not a schedule-settings rule). */
export function lessonOverrideRescheduleId(entryId: string): string {
  return `${LESSON_OVERRIDE_RESCHEDULE_ID_PREFIX}${String(entryId).trim()}`;
}

/** Synthetic override id for an Extra lesson row. */
export function lessonOverrideExtraId(entryId: string): string {
  return `${LESSON_OVERRIDE_EXTRA_ID_PREFIX}${String(entryId).trim()}`;
}

/**
 * Stable override identity for a displayed lesson row.
 * Regular → schedule rule id; Reschedule → `rs:{entryId}`; Extra → `ex:{entryId}`.
 */
export function lessonOverrideIdForRow(opts: {
  scheduleRuleId?: string | null;
  rescheduleEntryId?: string | null;
  extraEntryId?: string | null;
}): string {
  const rs = String(opts.rescheduleEntryId ?? "").trim();
  if (rs) return lessonOverrideRescheduleId(rs);
  const ex = String(opts.extraEntryId ?? "").trim();
  if (ex) return lessonOverrideExtraId(ex);
  return String(opts.scheduleRuleId ?? "").trim();
}

export function parseLessonOverrideSlotKey(
  key: string,
): { scheduleRuleId: string; dateIso: string } | null {
  const m = SLOT_KEY_RE.exec(String(key ?? "").trim());
  if (!m) return null;
  return { scheduleRuleId: m[1], dateIso: m[2] };
}

/** Calendar date for a legacy date key or a slot key; otherwise null. */
export function overrideDateIsoFromKey(key: string): string | null {
  const trimmed = String(key ?? "").trim();
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  return parseLessonOverrideSlotKey(trimmed)?.dateIso ?? null;
}

export function isLessonOverrideSlotKey(key: string): boolean {
  return Boolean(parseLessonOverrideSlotKey(key));
}

function asOverrideEntry(raw: unknown): LessonDayOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as LessonDayOverride;
}

/**
 * Prefer per-slot override when `scheduleRuleId` is known; optionally fall back
 * to legacy date-only override (applies to every lesson that day without a slot entry).
 *
 * For tutor / lessonSummary, callers should pass `allowDateFallback: false` when a
 * slot id is known — otherwise one date-wide tutor smears across morning/afternoon.
 */
export function resolveLessonOverride(
  overrides: Record<string, unknown> | undefined,
  opts: {
    dateIso: string;
    scheduleRuleId?: string | null;
    allowDateFallback?: boolean;
  },
): LessonDayOverride | undefined {
  if (!overrides) return undefined;
  const dateIso = String(opts.dateIso ?? "").trim();
  if (!dateIso) return undefined;

  const ruleId = String(opts.scheduleRuleId ?? "").trim();
  const allowDateFallback = opts.allowDateFallback !== false;
  if (ruleId) {
    const slot = asOverrideEntry(overrides[lessonOverrideSlotKey(ruleId, dateIso)]);
    if (slot) return slot;
    if (!allowDateFallback) return undefined;
  }

  const legacy = asOverrideEntry(overrides[dateIso]);
  return legacy ?? undefined;
}

export function readLessonOverrideField(
  overrides: Record<string, unknown> | undefined,
  opts: {
    dateIso: string;
    scheduleRuleId?: string | null;
    allowDateFallback?: boolean;
  },
  field: keyof LessonDayOverride,
): string {
  const ov = resolveLessonOverride(overrides, opts);
  if (!ov) return "";
  return String(ov[field] ?? "").trim();
}

/**
 * Old materialize copied date-wide tutor/summary onto every slot that also got room.
 *
 * - Regular room-bearing slots: drop tutor/summary so Room Slot Tutor (Pammi @ Hope)
 *   can apply — those fields were smeared when splitting a date-wide override.
 * - Reschedule/Extra (`rs:` / `ex:`) room-bearing slots: keep tutor/summary. A Band
 *   room-only edit must still retain the date-wide Li + note on that makeup row.
 * - Any date that has a room-bearing slot: strip tutor from sibling slots with no
 *   room (Hope stuck on Li after Band was moved).
 */
export function scrubSmearedTutorFromRoomBearingSlotOverrides(
  overrides: Record<string, LessonDayOverride>,
): Record<string, LessonDayOverride> {
  let changed = false;
  const next: Record<string, LessonDayOverride> = { ...overrides };
  const datesWithRoomSlot = new Set<string>();
  const recoveredByDate = new Map<string, { tutors: string[]; summaries: string[] }>();

  const rememberSmear = (dateIso: string, tutor: string, summary: string) => {
    const bucket = recoveredByDate.get(dateIso) ?? { tutors: [], summaries: [] };
    if (tutor) bucket.tutors.push(tutor);
    if (summary.trim()) bucket.summaries.push(summary);
    recoveredByDate.set(dateIso, bucket);
  };

  for (const [key, raw] of Object.entries(next)) {
    if (!isLessonOverrideSlotKey(key)) continue;
    const ov = asOverrideEntry(raw);
    if (!ov) continue;
    const parsed = parseLessonOverrideSlotKey(key);
    if (!parsed) continue;
    const hasRoom = Boolean(String(ov.room ?? "").trim());
    if (hasRoom) datesWithRoomSlot.add(parsed.dateIso);

    const isMakeupOrExtra =
      parsed.scheduleRuleId.startsWith(LESSON_OVERRIDE_RESCHEDULE_ID_PREFIX) ||
      parsed.scheduleRuleId.startsWith(LESSON_OVERRIDE_EXTRA_ID_PREFIX);
    if (!hasRoom || isMakeupOrExtra) continue;
    if (ov.tutor == null && ov.lessonSummary == null) continue;
    rememberSmear(
      parsed.dateIso,
      String(ov.tutor ?? "").trim(),
      ov.lessonSummary !== undefined ? String(ov.lessonSummary) : "",
    );
    const cleaned: LessonDayOverride = { ...ov };
    delete cleaned.tutor;
    delete cleaned.lessonSummary;
    next[key] = cleaned;
    changed = true;
  }

  // Clear sibling slots with no room (Hope stuck on Li after Band was moved).
  for (const [key, raw] of Object.entries(next)) {
    const parsed = parseLessonOverrideSlotKey(key);
    if (!parsed || !datesWithRoomSlot.has(parsed.dateIso)) continue;
    const ov = asOverrideEntry(raw);
    if (!ov || String(ov.room ?? "").trim()) continue;
    const tutor = String(ov.tutor ?? "").trim();
    const summary = ov.lessonSummary !== undefined ? String(ov.lessonSummary) : "";
    if (!tutor && !summary) continue;
    rememberSmear(parsed.dateIso, tutor, summary);
    const cleaned: LessonDayOverride = { ...ov };
    delete cleaned.tutor;
    delete cleaned.lessonSummary;
    next[key] = cleaned;
    changed = true;
  }

  // Band makeup often kept only `{ room }` after an older scrub wiped tutor/summary.
  // Re-attach the unique smeared tutor/summary onto that single rs:/ex: room slot.
  for (const [dateIso, bucket] of recoveredByDate) {
    const uniqueTutors = [...new Set(bucket.tutors)];
    const uniqueSummaries = [...new Set(bucket.summaries)];
    if (uniqueTutors.length !== 1 && uniqueSummaries.length !== 1) continue;

    const makeupKeys: string[] = [];
    for (const [key, raw] of Object.entries(next)) {
      const parsed = parseLessonOverrideSlotKey(key);
      if (!parsed || parsed.dateIso !== dateIso) continue;
      const ov = asOverrideEntry(raw);
      if (!ov || !String(ov.room ?? "").trim()) continue;
      const isMakeupOrExtra =
        parsed.scheduleRuleId.startsWith(LESSON_OVERRIDE_RESCHEDULE_ID_PREFIX) ||
        parsed.scheduleRuleId.startsWith(LESSON_OVERRIDE_EXTRA_ID_PREFIX);
      if (!isMakeupOrExtra) continue;
      makeupKeys.push(key);
    }
    if (makeupKeys.length !== 1) continue;
    const mk = makeupKeys[0];
    const ov = { ...(asOverrideEntry(next[mk]) ?? {}) };
    let patched = false;
    if (uniqueTutors.length === 1 && !String(ov.tutor ?? "").trim()) {
      ov.tutor = uniqueTutors[0];
      patched = true;
    }
    if (uniqueSummaries.length === 1 && ov.lessonSummary == null) {
      ov.lessonSummary = uniqueSummaries[0];
      patched = true;
    }
    if (patched) {
      next[mk] = ov;
      changed = true;
    }
  }

  return changed ? next : overrides;
}

/**
 * When introducing a slot override on a date that still has a legacy date-wide
 * override, copy only room/time onto other rules for the same day first,
 * then drop the date key so morning/afternoon can diverge.
 *
 * Tutor / lessonSummary are intentionally NOT copied onto siblings — those must
 * stay per-slot (or fall through to Room Slot Tutor), otherwise one date-wide
 * tutor smears across Band morning and Hope-Door afternoon.
 */

export function materializeLegacyDateOverrideToSlots(
  overrides: Record<string, LessonDayOverride>,
  opts: {
    dateIso: string;
    /** Rule receiving the new explicit slot write (skipped if it already has a slot). */
    focusScheduleRuleId?: string | null;
    otherScheduleRuleIdsOnDate: readonly string[];
  },
): Record<string, LessonDayOverride> {
  const dateIso = String(opts.dateIso ?? "").trim();
  const legacy = asOverrideEntry(overrides[dateIso]);
  if (!legacy || !dateIso) return overrides;

  const roomTimeOnly: LessonDayOverride = {};
  if (legacy.room != null && String(legacy.room).trim()) roomTimeOnly.room = legacy.room;
  if (legacy.time != null && String(legacy.time).trim()) roomTimeOnly.time = legacy.time;

  const next: Record<string, LessonDayOverride> = { ...overrides };
  for (const ruleId of opts.otherScheduleRuleIdsOnDate) {
    const id = String(ruleId ?? "").trim();
    if (!id) continue;
    const sk = lessonOverrideSlotKey(id, dateIso);
    if (next[sk]) continue;
    if (Object.keys(roomTimeOnly).length) next[sk] = { ...roomTimeOnly };
  }
  delete next[dateIso];
  return next;
}

export function upsertLessonSlotOrDateOverride(
  overrides: Record<string, LessonDayOverride>,
  opts: {
    dateIso: string;
    scheduleRuleId?: string | null;
    patch: LessonDayOverride;
    /** Other regular rule ids that also meet on this date (for legacy split). */
    otherScheduleRuleIdsOnDate?: readonly string[];
  },
): Record<string, LessonDayOverride> {
  const dateIso = String(opts.dateIso ?? "").trim();
  const ruleId = String(opts.scheduleRuleId ?? "").trim();
  let next = { ...overrides };

  if (ruleId) {
    // Capture before materialize deletes the date key.
    const legacyBefore = asOverrideEntry(next[dateIso]);
    next = materializeLegacyDateOverrideToSlots(next, {
      dateIso,
      focusScheduleRuleId: ruleId,
      otherScheduleRuleIdsOnDate: opts.otherScheduleRuleIdsOnDate ?? [],
    });
    const key = lessonOverrideSlotKey(ruleId, dateIso);
    const merged: LessonDayOverride = {
      ...(next[key] ?? {}),
      ...opts.patch,
    };
    // Room-only (or summary-only) edits must not throw away the date-wide tutor /
    // summary for THIS lesson — only siblings stay clear so Room Slot Tutor applies.
    if (
      legacyBefore &&
      !Object.prototype.hasOwnProperty.call(opts.patch, "tutor") &&
      merged.tutor == null &&
      String(legacyBefore.tutor ?? "").trim()
    ) {
      merged.tutor = legacyBefore.tutor;
    }
    if (
      legacyBefore &&
      !Object.prototype.hasOwnProperty.call(opts.patch, "lessonSummary") &&
      merged.lessonSummary == null &&
      legacyBefore.lessonSummary !== undefined
    ) {
      merged.lessonSummary = legacyBefore.lessonSummary;
    }
    // Empty tutor means "use room-slot default" — drop the field so it cannot stick.
    if (Object.prototype.hasOwnProperty.call(opts.patch, "tutor") && !String(opts.patch.tutor ?? "").trim()) {
      delete merged.tutor;
    }
    next[key] = merged;
    return next;
  }

  next[dateIso] = {
    ...(next[dateIso] ?? {}),
    ...opts.patch,
  };
  return next;
}

export function clearLessonSlotOrDateOverride(
  overrides: Record<string, LessonDayOverride>,
  opts: {
    dateIso: string;
    scheduleRuleId?: string | null;
    otherScheduleRuleIdsOnDate?: readonly string[];
  },
): Record<string, LessonDayOverride> {
  const dateIso = String(opts.dateIso ?? "").trim();
  const ruleId = String(opts.scheduleRuleId ?? "").trim();
  let next = { ...overrides };

  if (ruleId) {
    next = materializeLegacyDateOverrideToSlots(next, {
      dateIso,
      focusScheduleRuleId: ruleId,
      otherScheduleRuleIdsOnDate: opts.otherScheduleRuleIdsOnDate ?? [],
    });
    delete next[lessonOverrideSlotKey(ruleId, dateIso)];
    return next;
  }

  delete next[dateIso];
  return next;
}
