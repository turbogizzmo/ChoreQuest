import { useState } from 'react';
import { Flame } from 'lucide-react';

function getFlameProps(streak) {
  if (streak >= 30) {
    return { size: 28, className: 'text-orange-400' };
  }
  if (streak >= 7) {
    return { size: 22, className: 'text-orange-400' };
  }
  return { size: 18, className: 'text-orange-400/70' };
}

export default function StreakDisplay({ streak = 0, longest = 0 }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const flameProps = getFlameProps(streak);
  const isEpic = streak >= 30;

  return (
    <div
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Flame Icon */}
      <Flame size={flameProps.size} className={flameProps.className} />

      {/* Streak Count */}
      <span className="font-bold text-orange-400 text-sm tabular-nums">
        {streak}
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-surface-raised border border-border rounded-lg text-center whitespace-nowrap z-10">
          <p className="text-cream text-xs font-medium">
            {streak} day streak
          </p>
          <p className="text-muted text-[10px]">
            Best: {longest}
          </p>
          <div className="absolute top-full right-3 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-border" />
        </div>
      )}
    </div>
  );
}
