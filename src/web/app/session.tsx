import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Appearance, Capabilities, PublicUser, SessionInfo } from '../../shared/types';
import { api, setCsrfToken } from '../shared/api';
import { applyAppearance, DEFAULT_APPEARANCE, readLocalAppearance } from '../shared/theme';

export interface Meta {
  version: string;
  capabilities: Capabilities;
  appearance: Appearance;
  preferences: { digestEnabled: boolean; timezone?: string };
  ai: {
    configured: boolean;
    chat: boolean;
    embeddings: boolean;
    reasons: string[];
    embeddingCoverage: { chunks: number; embedded: number; model: string | null };
  };
  search: { chunks: number; embedded: number; model: string | null; objects: number; semanticAvailable: boolean };
  app: {
    instanceName: string;
    backupRetention: number;
    digestTime: string;
    maxUploadMb: number;
    aiDailyTokenBudget: number;
    pdfMetadataMode: 'text' | 'images' | 'ocr';
  };
  user: PublicUser;
}

interface SessionValue {
  user: PublicUser | null;
  meta: Meta | null;
  setupRequired: boolean;
  loading: boolean;
  logoLabel: string;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  updateAppearance: (patch: Partial<Appearance>) => Promise<void>;
  updateMeta: (patch: Partial<Meta>) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  meta: null,
  setupRequired: false,
  loading: true,
  logoLabel: 'Loom',
  refresh: async () => undefined,
  setUser: () => undefined,
  updateAppearance: async () => undefined,
  updateMeta: () => undefined,
  logout: async () => undefined,
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

const initialAppearance = readLocalAppearance() ?? DEFAULT_APPEARANCE;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    applyAppearance(initialAppearance);
  }, []);

  const loadMeta = useCallback(async () => {
    const value = await api.get<Meta>('/meta');
    setMeta(value);
    setUserState(value.user);
    applyAppearance(value.appearance);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const session = await api.get<SessionInfo>('/auth/session');
      setCsrfToken(session.csrfToken);
      setSetupRequired(session.setupRequired);
      if (session.user) {
        setUserState(session.user);
        await loadMeta();
      } else {
        setUserState(null);
        setMeta(null);
      }
    } catch {
      setUserState(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [loadMeta]);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setUserState(null);
      setMeta(null);
    };
    window.addEventListener('loom:unauthorized', onUnauthorized);
    return () => window.removeEventListener('loom:unauthorized', onUnauthorized);
  }, [refresh]);

  useEffect(() => {
    if (!meta) return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const listener = () => {
      if (meta.appearance.mode === 'system') applyAppearance(meta.appearance);
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [meta]);

  const updateAppearance = useCallback(async (patch: Partial<Appearance>) => {
    if (!meta) return;
    const next = { ...meta.appearance, ...patch };
    applyAppearance(next);
    setMeta({ ...meta, appearance: next });
    try {
      const saved = await api.patch<Appearance>('/settings/appearance', patch);
      applyAppearance(saved);
      setMeta((current) => (current ? { ...current, appearance: saved } : current));
    } catch {
      // local appearance remains; server will reconcile on next load
    }
  }, [meta]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    setCsrfToken(null);
    setUserState(null);
    setMeta(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      meta,
      setupRequired,
      loading,
      logoLabel: meta?.app.instanceName ?? 'Loom',
      refresh,
      setUser: (next) => {
        setUserState(next);
        if (next) void loadMeta();
      },
      updateAppearance,
      updateMeta: (patch) => setMeta((current) => (current ? { ...current, ...patch } : current)),
      logout,
    }),
    [user, meta, setupRequired, loading, refresh, updateAppearance, logout, loadMeta],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
