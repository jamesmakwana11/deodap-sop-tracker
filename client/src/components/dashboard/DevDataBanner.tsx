export function DevDataBanner() {
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-xl border-2 border-dashed border-bad bg-bad-bg px-4 py-3 text-[14px] text-bad"
    >
      <span className="mt-0.5 rounded bg-bad px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-white">DEV DATA</span>
      <p>
        <strong>Development data — not real Meta results.</strong> These sample records exist only to build and test the
        dashboard. Ratings and SOP outcomes are typed in by hand, not calculated from Meta. Remove them with{' '}
        <code className="rounded bg-white/70 px-1">npm run db:clear:dev</code>.
      </p>
    </div>
  );
}
