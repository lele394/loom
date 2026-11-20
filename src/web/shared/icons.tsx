import type { SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'inbox'
  | 'journal'
  | 'calendar'
  | 'search'
  | 'activity'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'undo'
  | 'copy'
  | 'close'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'note'
  | 'task'
  | 'book'
  | 'git'
  | 'flask'
  | 'help'
  | 'link'
  | 'trash'
  | 'sparkles'
  | 'panel'
  | 'check'
  | 'edit'
  | 'arrow-up'
  | 'arrow-down'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'menu'
  | 'star'
  | 'pin'
  | 'archive'
  | 'clock'
  | 'folder'
  | 'external'
  | 'command'
  | 'more'
  | 'send';

const paths: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v10l-3 4H7l-3-4z" />
      <path d="M4 14h4l1 2h6l1-2h4" />
    </>
  ),
  journal: (
    <>
      <path d="M6 3h12a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-1.6-.5a1.7 1.7 0 0 0-1.8.4l-.1.1h-4l-.1-.1a1.7 1.7 0 0 0-1.8-.4l-1.6.5-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9l-.1-.2a1.7 1.7 0 0 0-1.4-1H2v-4h1.7a1.7 1.7 0 0 0 1.4-1l.1-.2a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4 1.6.5a1.7 1.7 0 0 0 1.8-.4l.1-.1h4l.1.1a1.7 1.7 0 0 0 1.8.4l1.6-.5 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.2a1.7 1.7 0 0 0 1.4 1H22v4h-1.7a1.7 1.7 0 0 0-1.4 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  git: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 8v8M18 11c0 4-5 3-9 3" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12h-3" /></>,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h7M9 16h7" />
    </>
  ),
  task: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 11 2 2 4-4M7 17h6" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19a2 2 0 0 1 2-2h13" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
      <path d="M7.5 14h9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1.2-1.5 2.5M12 17h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" />
      <path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="m13 5 4 4" />
    </>
  ),
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  download: <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />,
  upload: <path d="M12 16V4M7 8l5-5 5 5M5 21h14" />,
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.5 9a7 7 0 0 1 11.4-2L20 12M4 12l2.1 5a7 7 0 0 0 11.4-2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  pin: <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v11h14V9M10 13h4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11H3z" />,
  external: <path d="M14 4h6v6M20 4 11 13M19 14v6H4V5h6" />,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  send: <path d="m4 4 17 8-17 8 3-8zM7 12h14" />,
};

export function Icon({
  name,
  size = 17,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
