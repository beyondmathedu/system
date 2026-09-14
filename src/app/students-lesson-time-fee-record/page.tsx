import { buildAppTopNavViewer } from "@/lib/appTopNavViewer";
import { getViewerContext } from "@/lib/authz";
import { defaultLessonYear, hkYmdNow } from "@/lib/lessonCalendar";
import { loadFeeRecordBootstrapCached } from "@/lib/lessonDataServer";
import StudentsLessonTimeFeeRecordEntry from "./StudentsLessonTimeFeeRecordEntry";

export default async function StudentsLessonTimeFeeRecordPage() {
  const { m } = hkYmdNow();
  const initialYear = defaultLessonYear();
  const initialMonth = m;
  const viewer = await getViewerContext();
  const [navViewer, initialBootstrap] = await Promise.all([
    buildAppTopNavViewer(viewer),
    loadFeeRecordBootstrapCached(initialYear, initialMonth),
  ]);

  return (
    <StudentsLessonTimeFeeRecordEntry
      initialBootstrap={initialBootstrap}
      initialYear={initialYear}
      initialMonth={initialMonth}
      navViewer={navViewer}
    />
  );
}
