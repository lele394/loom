export function readModePath(referenceId: string, options: { page?: number; panel?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.page && options.page > 1) params.set('page', String(options.page));
  if (options.panel) params.set('panel', options.panel);
  const query = params.toString();
  return `/literature/${referenceId}/read${query ? `?${query}` : ''}`;
}

export function openReadWindow(referenceId: string, options: { page?: number } = {}): Window | null {
  const path = readModePath(referenceId, options);
  // An explicit blank target opens a normal new tab (or window, per browser settings)
  // instead of forcing a sized popup.
  const opened = window.open(path, '_blank');
  if (opened) {
    opened.focus();
    return opened;
  }
  window.location.assign(path);
  return null;
}
