import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { can, type AuthResponse, type MembershipDto, type Permission, type Role, type UserDto } from '@opspilot/shared';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from './api';

const ORG_KEY = 'opspilot.org';
const readOrg = () => {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
};

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: UserDto | null;
  memberships: MembershipDto[];
  currentOrgId: string | null;
  currentMembership: MembershipDto | null;
  role: Role | null;
  can: (p: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; inviteToken?: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: string) => void;
  setMemberships: (m: MembershipDto[], preferOrgId?: string) => void;
  setUser: (u: UserDto) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<UserDto | null>(null);
  const [memberships, setMembershipsState] = useState<MembershipDto[]>([]);
  const [orgId, setOrgId] = useState<string | null>(readOrg);
  const started = useRef(false);

  const applySession = useCallback((data: AuthResponse) => {
    setUser(data.user);
    setMembershipsState(data.memberships);
    setOrgId((prev) => {
      const next = data.memberships.some((m) => m.organization.id === prev) ? prev : (data.memberships[0]?.organization.id ?? null);
      try {
        if (next) localStorage.setItem(ORG_KEY, next);
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setMembershipsState([]);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setSessionLostHandler(clear);
    if (started.current) return;
    started.current = true;
    void refreshSession().then((data) => (data ? applySession(data) : setStatus('anonymous')));
    return () => {
      setSessionLostHandler(null);
    };
  }, [applySession, clear]);

  const value = useMemo<AuthState>(() => {
    const currentMembership = memberships.find((m) => m.organization.id === orgId) ?? null;
    const role = currentMembership?.role ?? null;
    return {
      status,
      user,
      memberships,
      currentOrgId: currentMembership ? orgId : null,
      currentMembership,
      role,
      can: (p) => can(role, p),
      async login(email, password) {
        const data = await api.post<AuthResponse>('/auth/login', { email, password });
        setAccessToken(data.accessToken);
        qc.clear();
        applySession(data);
      },
      async register(input) {
        const data = await api.post<AuthResponse>('/auth/register', input);
        setAccessToken(data.accessToken);
        qc.clear();
        applySession(data);
      },
      async logout() {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': /(?:^|; )csrf_token=([^;]+)/.exec(document.cookie)?.[1] ?? '' },
          });
        } finally {
          clear();
        }
      },
      switchOrg(id) {
        setOrgId(id);
        try {
          localStorage.setItem(ORG_KEY, id);
        } catch {
          /* ignore */
        }
        qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'org' });
      },
      setMemberships(m, prefer) {
        setMembershipsState(m);
        if (prefer) {
          setOrgId(prefer);
          try {
            localStorage.setItem(ORG_KEY, prefer);
          } catch {
            /* ignore */
          }
        }
      },
      setUser,
    };
  }, [status, user, memberships, orgId, qc, applySession, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** The current org id, guaranteed. Only call inside routes that require an organization. */
export function useOrgId(): string {
  const { currentOrgId } = useAuth();
  if (!currentOrgId) throw new Error('No organization selected');
  return currentOrgId;
}
