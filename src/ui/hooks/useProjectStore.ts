import { useState, useEffect, useCallback } from 'react';
import { store } from '../../store/project-store';
import type { ProjectState, ProjectAction } from '../../store/project-store';

export function useProjectStore(): [ProjectState, (action: ProjectAction) => void] {
  const [state, setState] = useState<ProjectState>(() => store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setState(store.getState());
    });
    return unsubscribe;
  }, []);

  const dispatch = useCallback((action: ProjectAction) => {
    store.dispatch(action);
  }, []);

  return [state, dispatch];
}
