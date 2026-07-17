'use client';

import { useState } from 'react';
import { Play, Pause, Trash2, ChevronRight, Clock, FileText } from 'lucide-react';
import type { Campaign } from '@/types';

const STATUS_STYLES: Record<Campaign['status'], string> = {
  active: 'badge badge-success',
  paused: 'badge badge-warning',
  draft:  'badge badge-neutral',
  error:  'badge badge-danger',
};

const STATUS_LABEL: Record<Campaign['status'], string> = {
  active:  'פעיל',
  paused:  'מושהה',
  draft:   'טיוטה',
  error:   'שגיאה',
};

interface CampaignCardProps {
  campaign: Campaign;
  onToggle: (id: string, status: Campaign['status']) => Promise<void>;
  onRunNow: (id: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onClick: (id: string) => void;
}

export function CampaignCard({ campaign, onToggle, onRunNow, onDelete, onClick }: CampaignCardProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsToggling(true);
    await onToggle(campaign.id, campaign.status).finally(() => setIsToggling(false));
  };

  const handleRunNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRunning(true);
    await onRunNow(campaign.id).finally(() => setIsRunning(false));
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`למחוק את הטייס האוטומטי "${campaign.name}"?`)) {
      await onDelete(campaign.id);
    }
  };

  return (
    <div
      onClick={() => onClick(campaign.id)}
      className="group bg-surface-secondary border border-edge hover:border-edge-hover rounded-xl p-5 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)]"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={STATUS_STYLES[campaign.status]}>
              {STATUS_LABEL[campaign.status]}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-white truncate">{campaign.name}</h3>
        </div>
        <ChevronRight size={14} className="text-white/20 group-hover:text-white/40 transition-colors mt-0.5 mr-2 flex-shrink-0 rotate-180" />
      </div>

      {/* Keywords */}
      <div className="flex flex-wrap gap-1 mb-4">
        {campaign.keywords.slice(0, 3).map((kw) => (
          <span key={kw} className="text-2xs bg-white/5 text-white/40 px-2 py-0.5 rounded-md">
            {kw}
          </span>
        ))}
        {campaign.keywords.length > 3 && (
          <span className="text-2xs text-white/30">+{campaign.keywords.length - 3}</span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-white/30 mb-4">
        <span className="flex items-center gap-1">
          <FileText size={11} />
          {campaign.posts_count} פוסטים
        </span>
        {campaign.next_run_at && (
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {new Date(campaign.next_run_at).toLocaleString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-edge pt-3">
        <button
          onClick={handleToggle}
          disabled={isToggling || campaign.status === 'draft'}
          className="btn btn-ghost btn-sm"
        >
          {campaign.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
          {campaign.status === 'active' ? 'השהה' : 'הפעל'}
        </button>

        <button
          onClick={handleRunNow}
          disabled={isRunning || campaign.status !== 'active'}
          className="btn btn-sm bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border-0"
        >
          <Play size={12} />
          {isRunning ? 'שולח...' : 'הרץ עכשיו'}
        </button>

        <button
          onClick={handleDelete}
          className="btn btn-danger btn-xs mr-auto"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
