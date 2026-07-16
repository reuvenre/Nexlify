'use client';

import { campaignsApi } from '@/lib/api-client';
import { CampaignForm } from '@/components/campaigns/CampaignForm';

export default function NewCampaignPage() {
  return (
    <CampaignForm
      mode="create"
      initial={{
        name: '',
        keywords: [],
        schedule_cron: '0 9 * * *',
        posts_per_run: 3,
        language: 'he',
        markup_percent: 15,
        min_discount: 20,
      }}
      onSubmit={(data) => campaignsApi.create(data)}
    />
  );
}
