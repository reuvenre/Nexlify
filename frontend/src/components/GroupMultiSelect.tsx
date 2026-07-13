'use client';

import { Check } from 'lucide-react';

export interface GroupOption {
  id: string;
  name: string;
  channel_id: string;
}

/**
 * Multi-select of Telegram groups. Selecting several publishes the SAME product to
 * every chosen group at once (each routed to its own Facebook page) — for a single
 * publish credit. An empty selection = the user's default channel.
 */
export function GroupMultiSelect({ channels, value, onChange, disabled }: {
  channels: GroupOption[];
  value: string[];              // selected channel_ids
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (cid: string) =>
    onChange(value.includes(cid) ? value.filter((x) => x !== cid) : [...value, cid]);

  if (channels.length === 0) {
    return <p className="text-2xs text-white/30">אין קבוצות שמורות — הוסף בהגדרות ← קבוצות. הפוסט ילך לערוץ ברירת המחדל.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => {
          const on = value.includes(ch.channel_id);
          return (
            <button
              key={ch.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(ch.channel_id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-40 ${
                on
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                  : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
              }`}
            >
              <span
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                  on ? 'bg-blue-500 border-blue-500' : 'border-white/30'
                }`}
              >
                {on && <Check size={10} className="text-white" />}
              </span>
              {ch.name}
            </button>
          );
        })}
      </div>
      <p className="text-2xs text-white/25 mt-1.5">
        {value.length > 1
          ? `יפורסם ל-${value.length} קבוצות בו-זמנית (קרדיט אחד).`
          : value.length === 1
            ? 'יפורסם לקבוצה אחת.'
            : 'ללא בחירה = ערוץ ברירת המחדל.'}
      </p>
    </div>
  );
}
