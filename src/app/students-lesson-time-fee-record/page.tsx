import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { defaultLessonYear, hkYmdNow } from "@/lib/lessonCalendar";
import { loadFeeRecordBootstrapCached } from "@/lib/lessonDataServer";
import StudentsLessonTimeFeeRecordPageClient from "./StudentsLessonTimeFeeRecordPageClient";

export default async function StudentsLessonTimeFeeRecordPage() {
  const { m } = hkYmdNow();
  const initialYear = defaultLessonYear();
  const initialMonth = m;
  const [viewer, initialBootstrap] = await Promise.all([
    getViewerContext(),
    loadFeeRecordBootstrapCached(initialYear, initialMonth),
  ]);
  const navViewer = await buildAppTopNavViewer(viewer);

  return (
    <StudentsLessonTimeFeeRecordPageClient
      initialBootstrap={initialBootstrap}
      initialYear={initialYear}
      initialMonth={initialMonth}
      navViewer={navViewer}
    />
  );
}
