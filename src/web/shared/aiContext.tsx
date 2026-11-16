import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ObjectType } from '../../shared/constants';

export interface AiContextObject {
  id: string;
  title: string;
  type: ObjectType | string;
}

export type AiScopeValue = 'global' | 'project' | 'selection';

interface AiContextValue {
  open: boolean;
  setOpen: (value: boolean) => void;
  context: AiContextObject[];
  addContext: (object: AiContextObject) => void;
  setContext: (objects: AiContextObject[]) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
  scope: AiScopeValue;
  setScope: (scope: AiScopeValue) => void;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  draft: string;
  setDraft: (value: string) => void;
  askAbout: (object: AiContextObject, question?: string) => void;
}

const defaultValue: AiContextValue = {
  open: false,
  setOpen: () => undefined,
  context: [],
  addContext: () => undefined,
  setContext: () => undefined,
  removeContext: () => undefined,
  clearContext: () => undefined,
  scope: 'global',
  setScope: () => undefined,
  projectId: null,
  setProjectId: () => undefined,
  draft: '',
  setDraft: () => undefined,
  askAbout: () => undefined,
};

const AiContextStore = createContext<AiContextValue>(defaultValue);
export function useAi(): AiContextValue {
  return useContext(AiContextStore);
}

export function AiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [context, setContextState] = useState<AiContextObject[]>([]);
  const [scope, setScope] = useState<AiScopeValue>('global');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const replaceContext = useCallback((objects: AiContextObject[]) => {
    setContextState(objects.slice(0, 12));
  }, []);
  const addContext = useCallback((object: AiContextObject) => {
    setContextState((current) =>
      current.some((item) => item.id === object.id) ? current : [...current, object].slice(-12),
    );
  }, []);
  const removeContext = useCallback((id: string) => {
    setContextState((current) => current.filter((item) => item.id !== id));
  }, []);
  const clearContext = useCallback(() => setContextState([]), []);
  const askAbout = useCallback(
    (object: AiContextObject, question?: string) => {
      addContext(object);
      setScope('selection');
      if (question) setDraft(question);
      setOpen(true);
    },
    [addContext],
  );

  const value = useMemo(
    () => ({
      open,
      setOpen,
      context,
      addContext,
      setContext: replaceContext,
      removeContext,
      clearContext,
      scope,
      setScope,
      projectId,
      setProjectId,
      draft,
      setDraft,
      askAbout,
    }),
    [open, context, addContext, replaceContext, removeContext, clearContext, scope, projectId, draft, askAbout],
  );
  return <AiContextStore.Provider value={value}>{children}</AiContextStore.Provider>;
}
