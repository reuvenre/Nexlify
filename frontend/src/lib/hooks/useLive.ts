'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Data that keeps itself current while it is on screen.
 *
 * Polls every `intervalMs` while the tab is visible, refreshes the moment the owner comes
 * back to the tab (or the window regains focus), and never stacks requests: a slow answer
 * is waited for, not raced. A failed refresh keeps the last good data on screen and says
 * so through `error` — a dashboard that blanks on one network blip is worse than one that
 * is a minute old.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  opts: { intervalMs?: number; deps?: unknown[]; enabled?: boolean } = {},
) {
  const { intervalMs = 20_000, deps = [], enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inflight = useRef(false);
  const lastRun = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    lastRun.current = Date.now();
    try {
      const next = await fetchRef.current();
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'הרענון נכשל');
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refresh();
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, intervalMs);
    // Coming back to the tab: catch up at once rather than wait out the interval.
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.current > 5_000) void refresh();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, intervalMs, enabled, ...deps]);

  return { data, error, loading, updatedAt, refresh };
}
