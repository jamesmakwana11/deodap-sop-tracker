import { MIN_PASSWORD_LENGTH } from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Input } from '../components/ui/controls';

/** Used both for the forced first-sign-in change and for changing it later. */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-7 shadow-sm">
        <h1 className="text-xl font-semibold text-navy">{forced ? 'Set your password' : 'Change password'}</h1>
        <p className="mt-1 text-[14px] text-muted">
          {forced ? 'You signed in with a temporary password. Choose your own to continue.' : 'Other devices will be signed out.'}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Field label={forced ? 'Temporary password' : 'Current password'}>
            <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            <Input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repeat new password">
            <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          {done && !forced && <Alert tone="success">Password changed.</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </Button>
          {forced && (
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
