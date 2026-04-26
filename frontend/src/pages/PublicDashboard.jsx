import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Flame,
  Star,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Users,
  Swords,
} from 'lucide-react';
import AvatarDisplay from '../components/AvatarDisplay';

const REFRESH_INTERVAL_MS = 60_000;

function ProgressBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="xp-bar">
      <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ChoreRow({ chore }) {
  const isDone = chore.status === 'completed' || chore.status === 'verified';
  return (
    <div className={`flex items-center gap-2 py-1 ${isDone ? 'opacity-60' : ''}`}>
      {isDone ? (
        <CheckCircle2 size={13} className="text-emerald flex-shrink-0" />
      ) : (
        <Clock size={13} className="text-muted flex-shrink-0" />
      )}
      <span className={`text-xs flex-1 truncate ${isDone ? 'line-through text-muted' : 'text-cream'}`}>
        {chore.chore_title}
      </span>
      <span className="text-gold text-[10px] font-medium flex-shrink-0">
        +{chore.points} XP
      </span>
    </div>
  );
}

function KidCard({ kid }) {
  const allDone =
    kid.today_total > 0 && kid.today_completed >= kid.today_total;

  return (
    <div
      className={`game-panel p-4 flex flex-col gap-3 ${
        allDone ? 'border-emerald/30' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <AvatarDisplay
          config={kid.avatar_config}
          size="md"
          name={kid.display_name}
          animate
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-cream text-sm font-semibold truncate">
            {kid.display_name}
          </h3>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="inline-flex items-center gap-1 text-gold text-xs font-medium">
              <Star size={11} fill="currentColor" />
              {kid.points_balance.toLocaleString()} XP
            </span>
            {kid.current_streak > 0 && (
              <span className="inline-flex items-center gap-1 text-orange-400 text-xs font-medium">
                <Flame size={11} fill="currentColor" />
                {kid.current_streak}
              </span>
            )}
          </div>
        </div>
        {allDone && (
          <CheckCircle2 size={20} className="text-emerald flex-shrink-0" />
        )}
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Today</span>
          <span className="text-cream font-medium">
            {kid.today_completed}/{kid.today_total} quests
          </span>
        </div>
        <ProgressBar completed={kid.today_completed} total={kid.today_total} />
      </div>

      {/* Chore list */}
      {kid.chores.length > 0 && (
        <div className="border-t border-border/50 pt-2 space-y-0.5">
          {kid.chores.map((chore) => (
            <ChoreRow key={chore.id} chore={chore} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PublicDashboard() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError('Missing dashboard token. Ask a parent for the correct link.');
      setLoading(false);
      return;
    }
    try {
      // This endpoint is intentionally public (no auth), so we use raw fetch
      // instead of the api/client wrapper which injects Bearer tokens.
      const res = await fetch(`/api/public/dashboard?token=${encodeURIComponent(token)}`);
      if (res.status === 403) {
        setError('Invalid or expired dashboard token. Ask a parent to share the correct link.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  const handleManualRefresh = () => {
    setLoading(true);
    fetchData();
  };

  return (
    <div className="min-h-screen bg-navy p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
              <Swords size={16} className="text-navy" />
            </div>
            <div>
              <h1 className="text-cream text-lg font-bold leading-tight">ChoreQuest</h1>
              <p className="text-muted text-xs">Family Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <p className="text-muted text-xs hidden sm:block">
                Updated {lastRefreshed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="game-btn game-btn-blue !py-1.5 !px-2.5 flex items-center gap-1.5 !text-xs"
              title="Refresh now"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="game-panel p-4 flex items-start gap-3 border-crimson/30">
            <AlertTriangle size={16} className="text-crimson flex-shrink-0 mt-0.5" />
            <p className="text-crimson text-sm">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && !error && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="game-panel p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-surface-raised" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 bg-surface-raised rounded w-24" />
                    <div className="h-2 bg-surface-raised rounded w-16" />
                  </div>
                </div>
                <div className="h-2 bg-surface-raised rounded" />
                <div className="space-y-1.5">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="h-2 bg-surface-raised rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Kids grid */}
        {data && (
          <>
            {data.kids.length === 0 ? (
              <div className="game-panel p-10 text-center">
                <Users size={40} className="text-muted/30 mx-auto mb-3" />
                <p className="text-muted text-sm">No kids registered yet.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {data.kids.map((kid) => (
                  <KidCard key={kid.id} kid={kid} />
                ))}
              </div>
            )}

            <p className="text-center text-muted text-xs">
              Auto-refreshes every minute · {data.date}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
