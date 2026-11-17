export type ReadSaveStatus = 'saved' | 'dirty' | 'saving' | 'offline';

const PRIORITY: Record<ReadSaveStatus, number> = {
  saved: 0,
  dirty: 1,
  saving: 2,
  offline: 3,
};

/** Combine the status of independent editors (notes and PDF annotations). */
export function mergeSaveStatus(current: ReadSaveStatus, next: ReadSaveStatus): ReadSaveStatus {
  return PRIORITY[next] >= PRIORITY[current] ? next : current;
}

export const SAVE_STATUS_LABEL: Record<ReadSaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Unsaved',
  saving: 'Saving…',
  offline: 'No connection',
};
