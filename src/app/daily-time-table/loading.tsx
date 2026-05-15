export default function DailyTimetableLoading() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] animate-pulse px-3 sm:px-5 lg:px-6">
        <div className="mb-4 h-10 rounded-lg bg-slate-200" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-24 bg-slate-200" />
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <div className="h-9 w-64 rounded-lg bg-slate-200" />
          </div>
          <div className="p-6">
            <div className="h-[480px] rounded-xl bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
