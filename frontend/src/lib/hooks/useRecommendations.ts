'use client';

import { useState, useEffect, useCallback } from 'react';
import { recommendationsApi } from '@/lib/api-client';
import type { AgentRecommendation, RecommendationAgentType, RecommendationCategory, RecommendationStatus } from '@/types';

interface Filters {
  status?: RecommendationStatus;
  agent_type?: RecommendationAgentType;
  category?: RecommendationCategory;
}

export function useRecommendations(initialFilters: Filters = { status: 'pending' }) {
  const [recommendations, setRecommendations] = useState<AgentRecommendation[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (f: Filters) => {
    setIsLoading(true);
    try {
      const data = await recommendationsApi.list(f);
      setRecommendations(data);
      setError(null);
    } catch (e: unknown) {
      setError((e as Error).message || 'שגיאה בטעינת ההמלצות');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetch(filters); }, [fetch, filters]);

  const approve = async (id: string, note?: string) => {
    const res = await recommendationsApi.approve(id, note);
    await fetch(filters);
    return res;
  };

  const reject = async (id: string, note?: string) => {
    const res = await recommendationsApi.reject(id, note);
    await fetch(filters);
    return res;
  };

  return {
    recommendations,
    filters,
    setFilters,
    isLoading,
    error,
    approve,
    reject,
    refetch: () => fetch(filters),
  };
}
