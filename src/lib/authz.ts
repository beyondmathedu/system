import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { TUTOR_SHARED_IPAD_EMAIL } from "@/lib/tutorConstants";
import { ALL_CLASSROOM_SLUGS } from "@/lib/tutorRoomAccess";

export type AppRole = "admin" | "tutor" | "student";

export type ViewerContext = {
  userId: string | null;
  email: string | null;
  role: AppRole | null;
  tutorId: string | null;
  studentId: string | null;
  /** 共用 iPad 帳：全部課室 + 可改出席／Lesson summary */
  isSharedIpadTutor: boolean;
  allowedRoomSlugs: string[];
};

type UserProfileRow = {
  role?: string | null;
  tutor_id?: string | null;
  student_id?: string | null;
};

type TutorRoomPermissionRow = {
  room_slug?: string | null;
};

async function getViewerContextUncached(): Promise<ViewerContext> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) {
    return {
      userId: null,
      email: null,
      role: null,
      tutorId: null,
      studentId: null,
      isSharedIpadTutor: false,
      allowedRoomSlugs: [],
    };
  }

  const email = String(auth.user?.email ?? "").trim().toLowerCase() || null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, tutor_id, student_id")
    .eq("user_id", userId)
    .maybeSingle();

  const profileRow = profile as UserProfileRow | null;
  const roleRaw = String(profileRow?.role ?? "").toLowerCase();
  const role: AppRole | null =
    roleRaw === "admin" || roleRaw === "tutor" || roleRaw === "student"
      ? (roleRaw as AppRole)
      : null;
  const tutorId = String(profileRow?.tutor_id ?? "").trim() || null;
  const studentId = String(profileRow?.student_id ?? "").trim() || null;

  const isSharedIpadTutor = email === TUTOR_SHARED_IPAD_EMAIL.trim().toLowerCase();

  let allowedRoomSlugs: string[] = [];
  if (isSharedIpadTutor) {
    allowedRoomSlugs = [...ALL_CLASSROOM_SLUGS];
  } else if (role === "tutor" && tutorId) {
    const { data: roomPermRows } = await supabase
      .from("tutor_room_permissions")
      .select("room_slug")
      .eq("tutor_id", tutorId);
    allowedRoomSlugs = (roomPermRows ?? [])
      .map((r) => String((r as TutorRoomPermissionRow).room_slug ?? "").trim().toLowerCase())
      .filter(Boolean);
  }

  return { userId, email, role, tutorId, studentId, isSharedIpadTutor, allowedRoomSlugs };
}

/** One Auth + profile fetch per React request tree (dedupes duplicate imports). */
export const getViewerContext = cache(getViewerContextUncached);
