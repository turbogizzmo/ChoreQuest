import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import AvatarDisplay from '../components/AvatarDisplay';
import { Trophy, Loader2, Flame, Swords } from 'lucide-react';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard() {
  const { user } = useAuth();
  const { leaderboard_enabled } = useSettings();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api('/api/stats/leaderboard');
      setEntries(data.leaderboard || data || []);
    } catch (err) {
      setError(err.message || 'Failed to load leaderboard');
    }
  }, []);

  useEffect(() => {
    if (!leaderboard_enabled) {
      setLoading(false);
      return;
    }
    fetchLeaderboard().finally(() => setLoading(false));
  }, [fetchLeaderboard, leaderboard_enabled]);

  useEffect(() => {
    const handler = () => { fetchLeaderboard(); };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchLeaderboard]);

  const topScore = entries.length > 0 ? Math.max(...entries.map((e) => e.weekly_xp || e.xp || 0), 1) : 1;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-cream text-lg font-semibold mb-5">
        Leaderboard
      </h1>

      {!leaderboard_enabled && (
        <div className="game-panel p-8 text-center">
          <p className="text-cream text-sm font-medium">Leaderboard Disabled</p>
          <p className="text-muted text-sm mt-1">
            The leaderboard has been turned off in family settings.
          </p>
        </div>
      )}

      {leaderboard_enabled && error && (
        <div className="mb-4 p-2.5 rounded-md border border-crimson/40 bg-crimson/10 text-crimson text-sm">
          {error}
        </div>
      )}

      {leaderboard_enabled && loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-accent animate-spin" />
        </div>
      )}

      {leaderboard_enabled && !loading && !error && entries.length === 0 && (
        <div className="game-panel p-8 text-center">
          <p className="text-muted text-sm">
            No XP earned this week yet.
          </p>
        </div>
      )}

      {leaderboard_enabled && !loading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry, idx) => {
            const xp = entry.weekly_xp || entry.xp || 0;
            const pct = topScore > 0 ? (xp / topScore) * 100 : 0;
            const isCurrentUser = entry.user_id === user?.id || entry.id === user?.id;
            const questsDone = entry.quests_completed || 0;
            const streak = entry.current_streak || 0;
            const totalXp = entry.total_xp || 0;
            const isTop3 = idx < 3;

            return (
              <div
                key={entry.user_id || entry.id || idx}
                className={`game-panel p-3 flex items-center gap-3 ${
                  isCurrentUser ? '!border-accent' : ''
                }`}
              >
                {/* Rank */}
                <div className="flex-shrink-0 w-8 text-center">
                  {isTop3 ? (
                    <span className="text-lg">{MEDALS[idx]}</span>
                  ) : (
                    <span className="text-muted text-sm font-medium">#{idx + 1}</span>
                  )}
                </div>

                {/* Avatar */}
                <div className="flex-shrink-0">
                  <AvatarDisplay
                    config={entry.avatar_config}
                    size={isTop3 ? 'md' : 'sm'}
                    name={entry.display_name || entry.username}
                    animate
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-cream text-sm font-medium truncate">
                    {entry.display_name || entry.username}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                    <span className="flex items-center gap-1">
                      <Swords size={11} className="text-accent" />
                      {questsDone} quest{questsDone !== 1 ? 's' : ''}
                    </span>
                    {streak > 0 && (
                      <span className="flex items-center gap-1">
                        <Flame size={11} className="text-orange-400" />
                        {streak}d
                      </span>
                    )}
                    {isTop3 && (
                      <span className="text-muted/60">
                        {totalXp} total
                      </span>
                    )}
                  </div>

                  {/* XP bar */}
                  <div className="xp-bar mt-1.5 !h-4">
                    <div
                      className="xp-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-navy font-medium text-[10px] z-10">
                      {xp} XP this week
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
