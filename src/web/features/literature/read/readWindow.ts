export function readModePath(referenceId: string, options: { page?: number; panel?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.page && options.page > 1) params.set('page', String(options.page));
  if (options.panel) params.set('panel', options.panel);
  const query = params.toString();
  return `/literature/${referenceId}/read${query ? `?${query}` : ''}`;
}

export function openReadWindow(referenceId: string, options: { page?: number } = {}): Window | null {
  const path = readModePath(referenceId, options);
  const opened = window.open(
    path,
    `loom-read-${referenceId}-${Date.now()}`,
    'popup=yes,width=1500,height=960,left=80,top=60',
  );
  if (opened) {
    opened.focus();
    return opened;
  }
  window.location.assign(path);
  return null;
}
