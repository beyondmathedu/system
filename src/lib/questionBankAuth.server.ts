import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function requireQuestionBankAdmin() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (viewer.role !== "admin") {
    return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { viewer };
}
