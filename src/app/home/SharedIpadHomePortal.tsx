import Link from "next/link";
import AppTopNav from "@/components/AppTopNav";
import { PRIMARY_GRADIENT } from "@/lib/appTheme";
import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import type { ViewerContext } from "@/lib/authz";
import { fetchClassroomMeta } from "@/lib/classroomsRegistry";
import { buildTutorRoomNavLinks, defaultRoomScheduleSearch } from "@/lib/tutorRoomAccess";

type Props = {
  viewer: ViewerContext;
};

export default async function SharedIpadHomePortal({ viewer }: Props) {
  const roomQuery = defaultRoomScheduleSearch(viewer);
  const links = buildTutorRoomNavLinks(viewer.allowedRoomSlugs);
  const [navViewer, ...enriched] = await Promise.all([
    buildAppTopNavViewer(viewer),
    ...links.map(async (item) => {
      const slug = item.href.replace(/^\/rooms\//, "");
      const meta = await fetchClassroomMeta(slug);
      return {
        ...item,
        description: meta?.description ?? "",
        href: `${item.href}?${roomQuery}`,
      };
    }),
  ]);

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 lg:px-6">
        <AppTopNav highlight="dashboard" viewer={navViewer} />

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5 text-white" style={{ backgroundImage: PRIMARY_GRADIENT }}>
            <h1 className="text-2xl font-bold tracking-tight">選擇教室</h1>
            <p className="mt-1 text-sm text-blue-100">請點選要進入的課室，記錄今日出席及 Lesson summary</p>
          </div>
          <ul className="divide-y divide-slate-100 p-4 sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0 lg:grid-cols-3">
            {enriched.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex h-full flex-col gap-1 rounded-xl border border-slate-200 px-4 py-4 transition hover:border-[#1d76c2]/40 hover:bg-slate-50"
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
