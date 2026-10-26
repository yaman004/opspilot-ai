import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { BarChart3, Clock, MessageSquareText, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ButtonLink } from '../components/ui';
import { SlaRail } from '../components/SlaRail';

const NOW = Date.now();
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

/** Illustrative rows for the hero. Labeled as an example so nobody mistakes them for live data. */
const SAMPLE = [
  { key: 'INC-1042', title: 'Checkout API returning 500 errors', severity: 'critical' as const, who: 'Ava L.', createdAt: iso(-200), due: iso(40), status: 'in_progress' as const },
  { key: 'INC-1038', title: 'Postgres replica lagging behind primary', severity: 'high' as const, who: 'Mateo S.', createdAt: iso(-300), due: iso(180), status: 'triaged' as const },
  { key: 'INC-1031', title: 'Partner API certificate expired', severity: 'critical' as const, who: 'Yuki T.', createdAt: iso(-300), due: iso(-35), status: 'blocked' as const },
  { key: 'INC-1027', title: 'Warehouse label printer offline', severity: 'low' as const, who: 'Ava L.', createdAt: iso(-1000), due: iso(5500), status: 'open' as const },
];
const sevDot = { critical: 'bg-crit', high: 'bg-high', medium: 'bg-med', low: 'bg-low' };

const features = [
  { icon: Clock, title: 'SLA clocks on every incident', body: 'Response and resolution deadlines come from your policy. Warnings and escalations fire once, to the right people.' },
  { icon: Sparkles, title: 'AI-assisted triage you can overrule', body: 'Suggested category, severity, team and first steps. You pick which suggestions to apply; the rest are ignored.' },
  { icon: MessageSquareText, title: 'Live collaboration', body: 'Assignments, comments and status changes appear for everyone watching. Internal notes stay with your responders.' },
  { icon: BarChart3, title: 'Numbers from real incidents', body: 'Response and resolution times, SLA compliance and team workload are calculated from your data, not estimated.' },
  { icon: Users, title: 'Roles that are enforced', body: 'Owner, admin, agent and viewer permissions are checked on the server for every request, per organization.' },
  { icon: ShieldCheck, title: 'A history nobody can edit', body: 'Every change is written to an audit log with who, what and when.' },
];

export function Landing() {
  const { status } = useAuth();
  useEffect(() => {
    document.title = 'OpsPilot AI · Incident management with SLA clocks';
  }, []);
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#12233a]">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden><path d="M5 21h5l3-9 4 13 3-8h7" fill="none" stroke="#3fc1cc" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          OpsPilot AI
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {status === 'authenticated' ? (
            <ButtonLink to="/app" variant="primary">Open dashboard</ButtonLink>
          ) : (
            <>
              <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
              <ButtonLink to="/register" variant="primary">Create account</ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-10 lg:grid-cols-[1fr_1.15fr] lg:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Know which incident is about to miss its SLA.</h1>
            <p className="mt-5 max-w-lg text-lg text-muted">
              OpsPilot AI tracks incidents from report to resolution: who owns each one, how much of its window is left, and what your team is carrying.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/register" variant="primary" className="px-5 py-2.5 text-[15px]">Start with your team</ButtonLink>
              <ButtonLink to="/login" className="px-5 py-2.5 text-[15px]">Sign in to your workspace</ButtonLink>
            </div>
          </div>

          <figure aria-label="Example incident queue" className="panel overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-muted">
              <span className="font-medium text-ink">Open incidents</span>
              <span>Example data</span>
            </div>
            <ul>
              {SAMPLE.map((r) => (
                <li key={r.key} className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0">
                  <span className={`absolute inset-y-0 left-0 w-1 ${sevDot[r.severity]}`} aria-hidden />
                  <span className="w-16 text-xs font-medium text-muted">{r.key}</span>
                  <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium">{r.title}</span>
                  <SlaRail compact incident={{ createdAt: r.createdAt, status: r.status, resolvedAt: null, sla: { responseDueAt: null, firstRespondedAt: null, resolutionDueAt: r.due, response: 'pending', resolution: new Date(r.due).getTime() < NOW ? 'breached' : 'pending' } }} />
                </li>
              ))}
            </ul>
          </figure>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="max-w-xl text-2xl font-semibold tracking-tight">Built for the people who get paged</h2>
            <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title}>
                  <dt className="flex items-center gap-2.5 font-semibold"><f.icon size={18} className="text-accent" aria-hidden /> {f.title}</dt>
                  <dd className="mt-1.5 text-sm text-muted">{f.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-lg text-xl font-semibold tracking-tight">Set up an organization, invite your responders, and log the first incident in a few minutes.</p>
            <ButtonLink to="/register" variant="primary" className="px-5 py-2.5 text-[15px]">Create an account</ButtonLink>
          </div>
        </section>
      </main>
      <footer className="border-t border-line px-5 py-6 text-center text-xs text-muted">OpsPilot AI · Incident and operations management</footer>
    </div>
  );
}
