import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Input } from '../components/ui/controls';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-7 shadow-sm">
        <h1 className="font-serif text-2xl font-semibold text-navy">DeoDap SOP Campaign Tracker</h1>
        <p className="mt-1 text-[14px] text-muted">Sign in with the account your admin created for you.</p>
        <div className="mt-5 flex flex-col gap-3">
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  );
}
