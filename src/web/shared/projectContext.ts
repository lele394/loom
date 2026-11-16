import { useOutletContext } from 'react-router-dom';
import type { Project } from '../../shared/types';

export interface ProjectOutlet {
  project: Project;
  reload: () => void;
}

export function useProject(): ProjectOutlet {
  return useOutletContext<ProjectOutlet>();
}
