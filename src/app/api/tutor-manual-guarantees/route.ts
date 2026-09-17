import { NextResponse, type NextRequest } from "next/server";
import { getViewerContext } from "@/lib/authz";
import {
  deleteTutorManualGuarantee,
  insertTutorManualGuarantee,
  updateTutorManualGuarantee,
} from "@/lib/tutorManualGuarantee.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: { tutorId?: unknown; dateIso?: unknown; time?: unknown; note?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await insertTutorManualGuarantee({
    tutorId: String(body.tutorId ?? ""),
    dateIso: String(body.dateIso ?? ""),
    time: String(body.time ?? ""),
    note: body.note != null ? String(body.note) : undefined,
  });

  if (!result.ok) {
    const status = result.duplicate ? 409 : result.tableMissing ? 503 : 400;
    return NextResponse.json(
      { ok: false, error: result.error, duplicate: result.duplicate ?? false },
      { status },
    );
  }

  return NextResponse.json({ ok: true, row: result.row });
}

export async function PATCH(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: {
    id?: unknown;
    tutorId?: unknown;
    dateIso?: unknown;
    time?: unknown;
    note?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await updateTutorManualGuarantee({
    id: String(body.id ?? ""),
    tutorId: String(body.tutorId ?? ""),
    dateIso: String(body.dateIso ?? ""),
    time: String(body.time ?? ""),
    note: body.note != null ? String(body.note) : undefined,
  });

  if (!result.ok) {
    const status = result.duplicate ? 409 : result.tableMissing ? 503 : 400;
    return NextResponse.json(
      { ok: false, error: result.error, duplicate: result.duplicate ?? false },
      { status },
    );
  }

  return NextResponse.json({ ok: true, row: result.row });
}

export async function DELETE(request: NextRequest) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (viewer.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await deleteTutorManualGuarantee(String(body.id ?? ""));
  if (!result.ok) {
    const status = result.tableMissing ? 503 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
