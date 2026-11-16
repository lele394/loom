import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';
import { useOnClickOutside } from './hooks';

// ── Toasts ───────────────────────────────────────────────────────────────
interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}
interface ToastContextValue {
  toast: (message: string, type?: ToastItem['type']) => void;
}
const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });
export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const toast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = ++counter.current;
    setItems((current) => [...current, { id, message, type }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.type}`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Confirm dialog ───────────────────────────────────────────────────────
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback<ConfirmFn>((options) => {
    setState(options);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          slim
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                className={state.danger ? 'btn danger' : 'btn primary'}
                onClick={() => close(true)}
                autoFocus
              >
                {state.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <p className="muted">{state.message}</p>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  wide,
  slim,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  slim?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = ref.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([disabled])',
    );
    setTimeout(() => focusable?.focus(), 10);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'wide' : ''} ${slim ? 'slim' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || !ref.current) return;
          const focusable = [...ref.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )].filter((element) => element.offsetParent !== null);
          if (!focusable.length) return;
          const first = focusable[0]!;
          const last = focusable[focusable.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-head">
          <div className="grow">
            <h3>{title}</h3>
            {description ? <div className="small faint" style={{ marginTop: 3 }}>{description}</div> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Small primitives ─────────────────────────────────────────────────────
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" />
      {label ? <span className="small muted">{label}</span> : null}
    </span>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
  icon = 'sparkles',
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={26} />
      <strong>{title}</strong>
      {children ? <div className="small" style={{ maxWidth: 460 }}>{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <div className="row between">
        <div>
          <strong>Something went wrong</strong>
          <div className="small muted" style={{ marginTop: 4 }}>{message}</div>
        </div>
        {retry ? <button className="btn" onClick={retry}>Retry</button> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  help,
  error,
  children,
  htmlFor,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const descriptionId = help || error ? `${id}-description` : undefined;
  let control = children;
  if (isValidElement(children) && Children.count(children) === 1) {
    const element = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
    const type = element.type;
    if (typeof type === 'string' && ['input', 'textarea', 'select'].includes(type)) {
      control = cloneElement(element, {
        id: element.props.id ?? id,
        ...(descriptionId ? { 'aria-describedby': descriptionId } : {}),
      });
    }
  }
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {control}
      {error ? (
        <span className="error-text" id={descriptionId}>{error}</span>
      ) : help ? (
        <span className="help" id={descriptionId}>{help}</span>
      ) : null}
    </div>
  );
}

export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: ReactNode;
  items: { label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean }[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span onClick={() => setOpen((value) => !value)}>{trigger}</span>
      {open ? (
        <div className="menu" style={{ top: 'calc(100% + 6px)', [align]: 0 }}>
          {items.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              style={item.danger ? { color: 'var(--danger)' } : undefined}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={15} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          className={`tab ${value === item.value ? 'active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Definition({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span className="tiny faint">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const { toast } = useToast();
  return (
    <button
      className="btn sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => toast('Copied to clipboard', 'success'),
          () => toast('Could not copy', 'error'),
        );
      }}
    >
      {label}
    </button>
  );
}
