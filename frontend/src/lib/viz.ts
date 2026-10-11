'use client';

import { useTheme } from '@/lib/hooks/useTheme';

/**
 * Chart colors for the dashboards. Each measure is its own chart (one axis per chart), and
 * each keeps the same hue everywhere it appears. Light and dark are separate steps of the
 * same hues, validated against each surface (#ffffff light, #101117 dark): clicks blue,
 * commissions aqua, posts violet. Aqua sits under 3:1 on white, so every chart that uses it
 * prints its value as text too (the header total and the tooltip).
 */
const LIGHT = { clicks: '#2a78d6', commissions: '#1baf7a', posts: '#6250d6', grid: 'rgba(15,17,23,0.07)', axis: 'rgba(15,17,23,0.45)', cursor: 'rgba(15,17,23,0.25)', surface: '#ffffff' };
const DARK = { clicks: '#3987e5', commissions: '#199e70', posts: '#9085e9', grid: 'rgba(236,238,244,0.06)', axis: 'rgba(236,238,244,0.42)', cursor: 'rgba(236,238,244,0.25)', surface: '#101117' };

export type VizColors = typeof LIGHT;

export function useVizColors(): VizColors {
  const { theme } = useTheme();
  return theme === 'dark' ? DARK : LIGHT;
}
