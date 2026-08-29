/**
 * Instant loading skeleton for /dashboard/*.
 *
 * Rendered by Next during route transitions BEFORE the destination
 * page component finishes fetching its data. Users see the shell fill
 * in immediately instead of a blank screen for 200-400 ms.
 */
export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-56 bg-gray-200 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl border border-gray-200" />
        ))}
      </div>
      <div className="h-64 bg-gray-100 rounded-xl border border-gray-200" />
    </div>
  );
}
