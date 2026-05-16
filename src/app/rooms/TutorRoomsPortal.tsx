import Link from "next/link";
import { redirect } from "next/navigation";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { getViewerContext } from "@/lib/authz";
import { fetchClassroomMeta } from "@/lib/classroomsRegistry";
import {
  buildTutorRoomNavLinks,
  defaultRoomScheduleSearch,
  getTutorLandingPath,
  isSharedIpadTutorViewer,
  isTutorViewer,
} from "@/lib/tutorRoomAccess";

export default async function TutorRoomsPortal() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login?next=/rooms");
  if (!isTutorViewer(viewer)) redirect("/rooms");

  const links = buildTutorRoomNavLinks(viewer.allowedRoomSlugs);
  if (links.length === 1) {
    redirect(`${links[0]!.href}?${defaultRoomScheduleSearch(viewer)}`);
  }
  if (links.length === 0) {
    const landing = getTutorLandingPath(viewer);
    if (landing) redirect(landing);
    redirect("/login");
  }

  const enriched = await Promise.all(
    links.map(async (item) => {
      const slug = item.href.replace(/^\/rooms\//, "");
      const meta = await fetchClassroomMeta(slug);
      return {
        ...item,
        description: meta?.description ?? "",
      };
    }),
  );

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="rooms" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold">我的教室</h1>
            <p className="mt-1 text-sm text-blue-100">
              {isSharedIpadTutorViewer(viewer)
                ? "請選擇教室；可記錄出席及 Lesson summary"
                : "請選擇要查看的房間課表（唯讀）"}
            </p>
          </div>
          <ul className="divide-y divide-slate-100 p-4">
            {enriched.map((item) => (
              <li key={item.href}>
                <Link
                  href={`${item.href}?${defaultRoomScheduleSearch(viewer)}`}
                  className="flex flex-col gap-1 rounded-lg px-4 py-3 hover:bg-slate-50"
                >
                  <span className="text-lg font-semibold text-slate-900">{item.label}</span>
                  {item.description ? (
                    <span className="text-sm text-slate-600">{item.description}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
