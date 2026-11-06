import type { ReactNode } from 'react';

export function Section({
  title,
  intro,
  action,
  children,
}: {
  title: string;
  intro?: ReactNode;
  /** Shown at the right of the title (e.g. an Export button). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="border-l-4 border-brand pl-3 text-xl font-semibold text-navy">{title}</h2>
        {action}
      </div>
      {intro && <p className="mt-2 text-[15px] text-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
