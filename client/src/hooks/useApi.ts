import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/http';

export type ApiState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'error'; data?: undefined; error: string }
  | { status: 'ready'; data: T; error?: undefined };

/** GETs `path` (null = skip) and re-fetches when it changes or reload() is called. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ status: 'error', error: err.message });
      });
    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setKey((k) => k + 1), []);
  const setData = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { ...state, reload, setData };
}
