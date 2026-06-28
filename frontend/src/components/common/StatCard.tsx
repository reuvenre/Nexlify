import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  accent?: 'blue' | 'green' | 'violet' | 'amber';
}

const ACCENTS = {
  blue:   { bg: 'bg-gradient-to-br from-blue-500/20 to-blue-500/5',       icon: 'text-blue-300',    border: 'border-blue-500/20',    glow: 'hover:shadow-[0_18px_40px_-20px_rgba(59,130,246,0.45)]' },
  green:  { bg: 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5', icon: 'text-emerald-300', border: 'border-emerald-500/20', glow: 'hover:shadow-[0_18px_40px_-20px_rgba(16,185,129,0.45)]' },
  violet: { bg: 'bg-gradient-to-br from-violet-500/20 to-violet-500/5',   icon: 'text-violet-300',  border: 'border-violet-500/20',  glow: 'hover:shadow-[0_18px_40px_-20px_rgba(139,92,246,0.45)]' },
  amber:  { bg: 'bg-gradient-to-br from-amber-500/20 to-amber-500/5',     icon: 'text-amber-300',   border: 'border-amber-500/20',   glow: 'hover:shadow-[0_18px_40px_-20px_rgba(245,158,11,0.45)]' },
};

export function StatCard({ label, value, sub, icon: Icon, trend, accent = 'blue' }: StatCardProps) {
  const a = ACCENTS[accent];
  return (
    <div className={`group bg-surface-secondary border ${a.border} rounded-2xl p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-edge-hover ${a.glow}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-xl ${a.bg} border ${a.border} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
          <Icon size={16} className={a.icon} />
        </div>
        {trend && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
            ${trend.value >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
            }`}>
            {trend.value >= 0 ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
      <p className="text-xs text-white/40 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
      {trend && <p className="text-xs text-white/30 mt-1">{trend.label}</p>}
    </div>
  );
}
