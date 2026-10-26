import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  CircleAlert,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Sun,
  Timer,
  Users,
  X,
} from 'lucide-react';
import type { NotificationDto, Paginated, Permission } from '@opspilot/shared';
import { api } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { fmtRelative, label } from '../lib/format';
import { RealtimeBridge } from '../lib/realtime';
import { useTheme } from '../lib/ui-state';
import { Avatar, Button, SeverityBadge } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  perm?: Permission;
}
const NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/incidents', label: 'Incidents', icon: CircleAlert },
  { to: '/app/triage', label: 'AI triage', icon: Sparkles, perm: 'ai:triage' },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/notifications', label: 'Notifications', icon: Bell },
  { to: '/app/team', label: 'Team', icon: Users },
  { to: '/app/sla', label: 'SLA policy', icon: Timer },
  { to: '/app/audit', label: 'Audit log', icon: ScrollText, perm: 'audit:read' },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

/** Closes a popover on outside click / Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Brand() {
  return (
    <Link to="/app" className="flex items-center gap-2.5 px-1" aria-label="OpsPilot AI home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#12233a]">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
          <path d="M5 21h5l3-9 4 13 3-8h7" fill="none" stroke="#3fc1cc" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">OpsPilot AI</span>
    </Link>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const orgId = useOrgId();
  const unread = useQuery({
    queryKey: ['org', orgId, 'notifications', 'unread-count'],
    queryFn: () => api.get<{ unreadCount: number }>(`/orgs/${orgId}/notifications`, { pageSize: 1, unread: 'true' }),
    refetchInterval: 60_000,
  });
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/app'}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken/70 hover:text-ink',
            )
          }
        >
          <n.icon size={17} aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.to === '/app/notifications' && (unread.data?.unreadCount ?? 0) > 0 && (
            <span className="rounded-full bg-crit px-1.5 text-xs font-semibold text-white" aria-label={`${unread.data?.unreadCount} unread`}>
              {unread.data?.unreadCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function OrgSwitcher() {
  const { memberships, currentMembership, switchOrg } = useAuth();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded border border-line bg-surface px-2.5 py-2 text-left hover:bg-sunken"
      >
        <Building2 size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{currentMembership?.organization.name}</span>
          <span className="block text-xs text-muted">{label(currentMembership?.role ?? '')}</span>
        </span>
        <ChevronsUpDown size={14} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div role="listbox" aria-label="Organizations" className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-line bg-surface p-1 shadow-xl">
          {memberships.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={m.organization.id === currentMembership?.organization.id}
              onClick={() => {
                switchOrg(m.organization.id);
                setOpen(false);
                navigate('/app');
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-sunken"
            >
              <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
              <span className="text-xs text-muted">{label(m.role)}</span>
              {m.organization.id === currentMembership?.organization.id && <Check size={14} className="text-accent" aria-hidden />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <Link to="/onboarding" onClick={() => setOpen(false)} className="block rounded px-2.5 py-2 text-sm text-accent hover:bg-sunken">
            Create organization
          </Link>
        </div>
      )}
    </div>
  );
}

interface SearchResult {
  incidents: Array<{ id: string; key: string; title: string; status: any; severity: any }>;
  teams: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string; email: string }>;
}

function GlobalSearch() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const { open, setOpen, ref } = usePopover();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const results = useQuery({
    queryKey: ['org', orgId, 'search', debounced],
    queryFn: () => api.get<SearchResult>(`/orgs/${orgId}/search`, { q: debounced }),
    enabled: debounced.length >= 2,
  });
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  const empty = results.data && !results.data.incidents.length && !results.data.teams.length && !results.data.members.length;

  return (
    <div className="relative w-full max-w-md" ref={ref} role="search">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results.data?.incidents[0]) go(`/app/incidents/${results.data.incidents[0].id}`);
        }}
        placeholder="Search incidents, teams, people"
        aria-label="Search incidents, teams and people"
        className="input py-1.5 pl-9 pr-14 text-sm"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-xs text-muted sm:block">Ctrl K</kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-xl" role="listbox" aria-label="Search results">
          {results.isLoading && <p className="p-3 text-sm text-muted">Searching…</p>}
          {results.isError && <p className="p-3 text-sm text-crit">Search failed. Try again.</p>}
          {empty && <p className="p-3 text-sm text-muted">Nothing matches “{debounced}”.</p>}
          {results.data?.incidents.map((i) => (
            <button key={i.id} role="option" aria-selected={false} onClick={() => go(`/app/incidents/${i.id}`)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-sunken">
              <span className="w-[4.5rem] shrink-0 font-medium text-muted">{i.key}</span>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <SeverityBadge severity={i.severity} />
            </button>
          ))}
          {results.data?.teams.map((t) => (
            <button key={t.id} role="option" aria-selected={false} onClick={() => go('/app/team')} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-sunken">
              <Users size={14} className="text-muted" aria-hidden /> {t.name}
              <span className="ml-auto text-xs text-muted">Team</span>
            </button>
          ))}
          {results.data?.members.map((m) => (
            <button key={m.id} role="option" aria-selected={false} onClick={() => go(`/app/incidents?assigneeId=${m.id}`)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-sunken">
              <Avatar name={m.name} size={20} /> {m.name}
              <span className="ml-auto truncate text-xs text-muted">Their incidents</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationCenter() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  const list = useQuery({
    queryKey: ['org', orgId, 'notifications', 'recent'],
    queryFn: () => api.get<Paginated<NotificationDto> & { unreadCount: number }>(`/orgs/${orgId}/notifications`, { pageSize: 8 }),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] });
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/orgs/${orgId}/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post(`/orgs/${orgId}/notifications/read-all`), onSuccess: refresh });
  const unread = list.data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded p-2 text-muted hover:bg-sunken hover:text-ink"
      >
        <Bell size={18} aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-crit" aria-hidden />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-40 mt-1 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <Button size="sm" variant="ghost" disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all read
            </Button>
          </div>
          <div className="max-h-96 overflow-auto">
            {list.isLoading && <p className="p-4 text-sm text-muted">Loading…</p>}
            {list.isError && <p className="p-4 text-sm text-crit">Could not load notifications.</p>}
            {list.data && !list.data.items.length && <p className="p-6 text-center text-sm text-muted">You're all caught up.</p>}
            {list.data?.items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.readAt) readOne.mutate(n.id);
                  setOpen(false);
                  if (n.incidentId) navigate(`/app/incidents/${n.incidentId}`);
                }}
                className={clsx('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunken', !n.readAt && 'bg-accent/5')}
              >
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-muted">{fmtRelative(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link to="/app/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm text-accent hover:bg-sunken">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const { pref, setPref } = useTheme();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  const themes = [
    { v: 'light', icon: Sun, l: 'Light' },
    { v: 'dark', icon: Moon, l: 'Dark' },
    { v: 'system', icon: Monitor, l: 'System' },
  ] as const;
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} className="rounded-full">
        <Avatar name={user.name} size={32} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="mx-2 mb-1 flex rounded border border-line p-0.5" role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <button
                key={t.v}
                role="radio"
                aria-checked={pref === t.v}
                onClick={() => setPref(t.v)}
                className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium', pref === t.v ? 'bg-sunken text-ink' : 'text-muted hover:text-ink')}
              >
                <t.icon size={13} aria-hidden /> {t.l}
              </button>
            ))}
          </div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate('/app/settings'); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-sunken">
            <Settings size={15} aria-hidden /> Profile and settings
          </button>
          <button role="menuitem" onClick={() => void logout().then(() => navigate('/login'))} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-crit hover:bg-sunken">
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const crumbTitle = useMemo(() => NAV.find((n) => (n.to === '/app' ? location.pathname === '/app' : location.pathname.startsWith(n.to)))?.label, [location.pathname]);

  useEffect(() => {
    document.title = `${crumbTitle ?? 'OpsPilot AI'} · OpsPilot AI`;
    mainRef.current?.focus({ preventScroll: true });
  }, [crumbTitle, location.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <RealtimeBridge />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col gap-5 border-r border-line bg-surface p-3 lg:flex">
        <div className="pt-1"><Brand /></div>
        <OrgSwitcher />
        <SideNav />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 bg-surface p-3 shadow-2xl">
            <div className="flex items-center justify-between pt-1">
              <Brand />
              <button onClick={() => setDrawer(false)} aria-label="Close navigation" className="rounded p-1.5 text-muted hover:bg-sunken"><X size={18} /></button>
            </div>
            <OrgSwitcher />
            <SideNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/90 px-3 py-2.5 backdrop-blur sm:px-6">
          <button onClick={() => setDrawer(true)} aria-label="Open navigation" className="rounded p-2 text-muted hover:bg-sunken lg:hidden"><Menu size={19} /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <NotificationCenter />
            <ProfileMenu />
          </div>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-[1280px] px-3 py-6 outline-none sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

