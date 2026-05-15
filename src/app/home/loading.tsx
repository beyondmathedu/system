export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-[1500px] animate-pulse px-3 sm:px-5 lg:px-6">
        <div className="mb-4 h-10 rounded-lg bg-slate-200" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-32 bg-slate-200" />
          <div className="space-y-3 p-6">
            <div className="h-20 rounded-lg bg-slate-100" />
            <div className="h-24 rounded-lg bg-slate-100" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="h-64 rounded-2xl bg-slate-100" />
              <div className="h-64 rounded-2xl bg-slate-100" />
              <div className="h-64 rounded-2xl bg-slate-100" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
