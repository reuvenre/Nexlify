'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Ease-out cubic count toward `target`, starting from wherever the number already was.
 *
 * The dashboards refresh live, so a new target must glide from the old value — counting
 * up from zero on every refresh made every tile flicker every twenty seconds. The first
 * time it counts up from zero, once.
 *
 * Returns the raw (un-rounded) value so callers decide their own precision. Honours
 * prefers-reduced-motion by jumping straight to the target.
 */
export function useCountUp(target: number, duration = 1400): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) { current.current = 0; setValue(0); return; }
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3));
      current.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
