import { createSupabaseServerClient } from "@/lib/supabaseServer";

export type AppRole = "admin" | "tutor" | "student";

export type ViewerContext = {
  userId: string | null;
  role: AppRole | null;
  tutorId: string | null;
  studentId: string | null;
  allowedRoomSlugs: string[];
};

export async function getViewerContext(): Promise<ViewerContext> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) {
    return { userId: null, role: null, tutorId: null, studentId: null, allowedRoomSlugs: [] };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, tutor_id, student_id")
    .eq("user_id", userId)
    .maybeSingle();

  const roleRaw = String((profile as any)?.role ?? "").toLowerCase();
  const role: AppRole | null =
    roleRaw === "admin" || roleRaw === "tutor" || roleRaw === "student"
      ? (roleRaw as AppRole)
      : null;
  const tutorId = String((profile as any)?.tutor_id ?? "").trim() || null;
  const studentId = String((profile as any)?.student_id ?? "").trim() || null;

  let allowedRoomSlugs: string[] = [];
  if (role === "tutor" && tutorId) {
    const { data: roomPermRows } = await supabase
      .from("tutor_room_permissions")
      .select("room_slug")
      .eq("tutor_id", tutorId);
    allowedRoomSlugs = (roomPermRows ?? [])
      .map((r) => String((r as any).room_slug ?? "").trim().toLowerCase())
      .filter(Boolean);
  }

  return { userId, role, tutorId, studentId, allowedRoomSlugs };
}
