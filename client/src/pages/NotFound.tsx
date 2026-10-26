import { Link } from 'react-router-dom';
import { ButtonLink } from '../components/ui';

export function NotFoundPage({ inApp }: { inApp?: boolean }) {
  return (
    <div className={inApp ? 'py-16' : 'grid min-h-screen place-items-center px-4'}>
      <div className="mx-auto max-w-md text-center">
        <p className="text-5xl font-semibold tracking-tight text-muted">404</p>
        <h1 className="mt-3 text-xl font-semibold">This page doesn't exist</h1>
        <p className="mt-1 text-sm text-muted">The link may be old, or the incident may belong to a different organization than the one you have open.</p>
        <div className="mt-5 flex justify-center gap-2">
          <ButtonLink to={inApp ? '/app' : '/'} variant="primary">{inApp ? 'Go to dashboard' : 'Go home'}</ButtonLink>
          {inApp && <ButtonLink to="/app/incidents">View incidents</ButtonLink>}
        </div>
      </div>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="py-16 text-center" role="alert">
      <h1 className="text-xl font-semibold">You don't have access to this page</h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">Your role in this organization doesn't include it. Ask an owner or admin if you need it.</p>
      <Link to="/app" className="mt-4 inline-block text-sm text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}
