export default function RoomScheduleLoading() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] animate-pulse px-3 sm:px-5 lg:px-6">
        <div className="mb-4 h-10 rounded-lg bg-slate-200" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-28 bg-slate-200" />
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              <div className="h-8 w-20 rounded-md bg-slate-200" />
              <div className="h-8 w-24 rounded-md bg-slate-200" />
              <div className="h-8 w-28 rounded-md bg-slate-200" />
            </div>
          </div>
          <div className="p-6">
            <div className="mb-3 flex gap-2">
              <div className="h-8 w-40 rounded-md bg-slate-200" />
              <div className="h-8 w-28 rounded-md bg-slate-200" />
              <div className="h-8 w-32 rounded-md bg-slate-200" />
            </div>
            <div className="h-[min(70vh,640px)] rounded-lg bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
