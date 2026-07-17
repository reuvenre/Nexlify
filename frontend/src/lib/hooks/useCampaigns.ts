'use client';

import { useState, useEffect, useCallback } from 'react';
import { campaignsApi } from '@/lib/api-client';
import type { Campaign, CampaignInput } from '@/types';

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (page = 1, limit = 20) => {
    setIsLoading(true);
    try {
      const res = await campaignsApi.list({ page, limit });
      setCampaigns(res.data);
      setTotal(res.total);
      setError(null);
    } catch (e: unknown) {
      setError((e as Error).message || 'שגיאה בטעינת הטייס האוטומטי');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (data: CampaignInput) => {
    const c = await campaignsApi.create(data);
    setCampaigns((prev) => [c, ...prev]);
    return c;
  };

  const toggle = async (id: string, status: Campaign['status']) => {
    const updated = status === 'active'
      ? await campaignsApi.pause(id)
      : await campaignsApi.resume(id);
    setCampaigns((prev) => prev.map((c) => c.id === id ? updated : c));
  };

  const runNow = async (id: string) => {
    return campaignsApi.runNow(id);
  };

  const remove = async (id: string) => {
    await campaignsApi.delete(id);
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  return { campaigns, total, isLoading, error, refetch: fetch, create, toggle, runNow, remove };
}
