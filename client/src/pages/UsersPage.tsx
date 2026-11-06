import { ROLE_DESCRIPTIONS, ROLES, type Role, type UserSummary } from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/dashboard/StatusPanels';
import { Card } from '../components/ui/Card';
import { Alert, Button, Field, Input, Select } from '../components/ui/controls';
import { Section } from '../components/ui/Section';
import { useApi } from '../hooks/useApi';
import { formatIst } from '../lib/format';

/** Shows a one-time password the admin must pass on; it is not stored anywhere readable. */
function TempPassword({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  return (
    <Alert tone="success">
      <div>
        Temporary password for <strong>{who}</strong>: <code className="rounded bg-white px-1.5 py-0.5 text-[15px] font-semibold">{password}</code>
      </div>
      <div className="mt-1 text-[13px]">Share it privately. It is shown only once, and they must change it when they first sign in.</div>
      <button type="button" className="mt-1 text-[13px] font-semibold underline" onClick={onClose}>
        Done
      </button>
    </Alert>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const state = useApi<{ users: UserSummary[] }>('/users');
  const [form, setForm] = useState({ email: '', name: '', role: 'viewer' as Role });
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      state.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api<{ user: UserSummary; temporaryPassword: string }>('/users', { method: 'POST', body: form });
      setTemp({ who: r.user.email, password: r.temporaryPassword });
      setForm({ email: '', name: '', role: 'viewer' });
    });
  }

  if (state.status === 'error') {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
        <ErrorState message={state.error} onRetry={state.reload} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-7">
      <h1 className="font-serif text-3xl font-semibold text-navy">Users</h1>
      <ul className="mt-2 space-y-0.5 text-[14px] text-muted">
        {ROLES.map((r) => (
          <li key={r}>
            <strong className="text-ink capitalize">{r}</strong> — {ROLE_DESCRIPTIONS[r]}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      </div>

      <Section title="Add a user">
        <Card>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-64" />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Create user</Button>
          </form>
        </Card>
      </Section>

      <Section title="Everyone with access">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="bg-head text-left text-navy">
                  {['Name', 'Email', 'Role', 'Status', 'Last sign-in', ''].map((h) => (
                    <th key={h} className="px-2.5 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data?.users.map((u) => (
                  <tr key={u.id} className={`border-b border-line ${u.isActive ? '' : 'text-muted'}`}>
                    <td className="px-2.5 py-2 font-semibold">
                      {u.name}
                      {u.id === me?.id && <span className="ml-1 text-[12px] font-normal text-muted">(you)</span>}
                    </td>
                    <td className="px-2.5 py-2">{u.email}</td>
                    <td className="px-2.5 py-2">
                      <Select
                        value={u.role}
                        aria-label={`Role for ${u.name}`}
                        onChange={(e) => void run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }).then(() => {}))}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2.5 py-2">
                      {!u.isActive ? 'Deactivated' : u.mustChangePassword ? 'Waiting for first sign-in' : 'Active'}
                    </td>
                    <td className="px-2.5 py-2">{u.lastLoginAt ? formatIst(u.lastLoginAt) : '–'}</td>
                    <td className="px-2.5 py-2">
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void run(async () => {
                              const r = await api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
                              setTemp({ who: u.email, password: r.temporaryPassword });
                            })
                          }
                        >
                          Reset password
                        </Button>
                        {u.id !== me?.id && (
                          <Button
                            variant={u.isActive ? 'danger' : 'secondary'}
                            onClick={() => void run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }).then(() => {}))}
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </main>
  );
}
