import { hasRole } from '@sop/shared';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

/** Loading, error and "no data yet" states for the dashboard. */

export function LoadingState() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-[86px] animate-pulse rounded-xl border border-line bg-white" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-6 rounded-xl border border-bad/40 bg-bad-bg px-5 py-4 text-bad">
      <p className="font-semibold">The tracker could not load.</p>
      <p className="mt-1 text-[14px]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg bg-white px-3 py-1.5 text-[14px] font-semibold text-bad ring-1 ring-bad/40 hover:bg-bad hover:text-white"
      >
        Try again
      </button>
    </div>
  );
}

export function NoDataState() {
  const { user } = useAuth();
  return (
    <div className="mt-6 rounded-xl border border-dashed border-line bg-white px-6 py-8 text-center">
      <p className="text-lg font-semibold text-navy">No audit data yet</p>
      <p className="mx-auto mt-2 max-w-xl text-[14px] text-muted">
        Connect Meta, pick the ad accounts to audit, then run the first refresh. Until then the dashboard stays empty
        rather than showing made-up numbers.
      </p>
      {hasRole(user, 'admin') ? (
        <Link to="/settings" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-[14px] font-semibold text-white">
          Connect Meta
        </Link>
      ) : (
        <p className="mt-3 text-[14px] text-muted">Ask an admin to connect the Meta ad accounts.</p>
      )}
    </div>
  );
}
