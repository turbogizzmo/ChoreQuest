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
const KIOSK_REFRESH_INTERVAL_MS = 120_000;
const KIOSK_SLIDE_INTERVAL_MS = 10_000; // how long each kid is shown

// ─── Normal mode subcomponents ───────────────────────────────────────────────

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
  const allDone = kid.today_total > 0 && kid.today_completed >= kid.today_total;
  return (
    <div className={`game-panel p-4 flex flex-col gap-3 ${allDone ? 'border-emerald/30' : ''}`}>
      <div className="flex items-center gap-3">
        <AvatarDisplay config={kid.avatar_config} size="md" name={kid.display_name} animate />
        <div className="min-w-0 flex-1">
          <h3 className="text-cream text-sm font-semibold truncate">{kid.display_name}</h3>
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
        {allDone && <CheckCircle2 size={20} className="text-emerald flex-shrink-0" />}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Today</span>
          <span className="text-cream font-medium">{kid.today_completed}/{kid.today_total} quests</span>
        </div>
        <ProgressBar completed={kid.today_completed} total={kid.today_total} />
      </div>
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

// ─── Kiosk mode subcomponents (Echo Show 15 / TV display) ────────────────────

function KioskProgressBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="w-full h-6 rounded-full bg-surface-raised overflow-hidden">
      <div
        className="h-full rounded-full bg-accent transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function KioskChoreRow({ chore }) {
  const isDone = chore.status === 'completed' || chore.status === 'verified';
  return (
    <div className={`flex items-center gap-4 py-2.5 border-b border-border/30 last:border-0 ${isDone ? 'opacity-50' : ''}`}>
      {isDone ? (
        <CheckCircle2 size={24} className="text-emerald flex-shrink-0" />
      ) : (
        <Clock size={24} className="text-muted flex-shrink-0" />
      )}
      <span className={`text-2xl flex-1 truncate ${isDone ? 'line-through text-muted' : 'text-cream'}`}>
        {chore.chore_title}
      </span>
      <span className="text-gold text-xl font-bold flex-shrink-0">+{chore.points} XP</span>
    </div>
  );
}

function KioskKidSlide({ kid, visible }) {
  const allDone = kid.today_total > 0 && kid.today_completed >= kid.today_total;
  const pct = kid.today_total > 0 ? Math.round((kid.today_completed / kid.today_total) * 100) : 0;

  return (
    <div
      className="absolute inset-0 flex flex-col gap-8 p-10 transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
    >
      {/* Hero header */}
      <div className="flex items-center gap-8 flex-shrink-0">
        <AvatarDisplay config={kid.avatar_config} size="xl" name={kid.display_name} animate />
        <div className="min-w-0 flex-1">
          <h2 className="text-cream font-bold leading-tight truncate" style={{ fontSize: '4rem' }}>
            {kid.display_name}
          </h2>
          <div className="flex items-center gap-8 mt-3">
            <span className="inline-flex items-center gap-2 text-gold font-semibold" style={{ fontSize: '2rem' }}>
              <Star size={28} fill="currentColor" />
              {kid.points_balance.toLocaleString()} XP
            </span>
            {kid.current_streak > 0 && (
              <span className="inline-flex items-center gap-2 text-orange-400 font-semibold" style={{ fontSize: '2rem' }}>
                <Flame size={28} fill="currentColor" />
                {kid.current_streak} day streak
              </span>
            )}
          </div>
        </div>
        {allDone && (
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <CheckCircle2 size={64} className="text-emerald" />
            <span className="text-emerald text-xl font-bold uppercase tracking-widest">All Done!</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-muted text-2xl">Today's Quests</span>
          <span className="text-cream text-3xl font-bold">
            {kid.today_completed} / {kid.today_total} &nbsp;
            <span className="text-muted text-2xl font-normal">({pct}%)</span>
          </span>
        </div>
        <KioskProgressBar completed={kid.today_completed} total={kid.today_total} />
      </div>

      {/* Quest list — fills remaining space */}
      {kid.chores.length > 0 && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="border-t-2 border-border/50 pt-4 flex flex-col overflow-hidden">
            {kid.chores.map((chore) => (
              <KioskChoreRow key={chore.id} chore={chore} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PublicDashboard() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const isKiosk = searchParams.get('kiosk') === '1';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [now, setNow] = useState(new Date());
  const [activeKidIndex, setActiveKidIndex] = useState(0);
  const intervalRef = useRef(null);
  const slideRef = useRef(null);

  // Live clock for kiosk mode
  useEffect(() => {
    if (!isKiosk) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, [isKiosk]);

  // Auto-cycle through kids in kiosk mode
  useEffect(() => {
    if (!isKiosk || !data || data.kids.length <= 1) return;
    slideRef.current = setInterval(() => {
      setActiveKidIndex((i) => (i + 1) % data.kids.length);
    }, KIOSK_SLIDE_INTERVAL_MS);
    return () => clearInterval(slideRef.current);
  }, [isKiosk, data]);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError('Missing dashboard token. Ask a parent for the correct link.');
      setLoading(false);
      return;
    }
    try {
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
    const interval = isKiosk ? KIOSK_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
    intervalRef.current = setInterval(fetchData, interval);
    return () => clearInterval(intervalRef.current);
  }, [fetchData, isKiosk]);

  // ── Kiosk layout ─────────────────────────────────────────────────────────
  if (isKiosk) {
    const kids = data?.kids ?? [];

    return (
      <div className="h-screen bg-navy flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-10 py-5 flex-shrink-0 border-b border-border/40">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <Swords size={22} className="text-navy" />
            </div>
            <div>
              <h1 className="text-cream text-3xl font-bold leading-tight">ChoreQuest</h1>
              <p className="text-muted text-base">Family Dashboard</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-cream font-bold tabular-nums" style={{ fontSize: '3rem' }}>
              {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </p>
            <p className="text-muted text-lg">
              {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-10 mt-6 game-panel p-5 flex items-center gap-3 border-crimson/30">
            <AlertTriangle size={24} className="text-crimson flex-shrink-0" />
            <p className="text-crimson text-xl">{error}</p>
          </div>
        )}

        {/* Kid slides — one at a time, full remaining height */}
        {kids.length > 0 && (
          <div className="flex-1 relative min-h-0">
            {kids.map((kid, i) => (
              <KioskKidSlide key={kid.id} kid={kid} visible={i === activeKidIndex} />
            ))}
          </div>
        )}

        {kids.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Users size={80} className="text-muted/30 mx-auto mb-6" />
              <p className="text-muted text-2xl">No kids registered yet.</p>
            </div>
          </div>
        )}

        {/* Footer — dot indicators + refresh time */}
        <div className="flex-shrink-0 flex items-center justify-center gap-6 py-4 border-t border-border/30">
          {kids.length > 1 && (
            <div className="flex items-center gap-2">
              {kids.map((kid, i) => (
                <button
                  key={kid.id}
                  onClick={() => setActiveKidIndex(i)}
                  className="transition-all duration-300"
                  title={kid.display_name}
                >
                  <div className={`rounded-full transition-all duration-300 ${
                    i === activeKidIndex
                      ? 'w-8 h-3 bg-accent'
                      : 'w-3 h-3 bg-muted/40 hover:bg-muted/70'
                  }`} />
                </button>
              ))}
            </div>
          )}
          <p className="text-muted/50 text-sm">
            {kids.length > 1 && `${kids[activeKidIndex]?.display_name} · `}
            Auto-refreshes every 2 min
            {lastRefreshed && ` · ${lastRefreshed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
          </p>
        </div>
      </div>
    );
  }

  // ── Normal layout ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-navy p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
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
              onClick={() => { setLoading(true); fetchData(); }}
              disabled={loading}
              className="game-btn game-btn-blue !py-1.5 !px-2.5 flex items-center gap-1.5 !text-xs"
              title="Refresh now"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="game-panel p-4 flex items-start gap-3 border-crimson/30">
            <AlertTriangle size={16} className="text-crimson flex-shrink-0 mt-0.5" />
            <p className="text-crimson text-sm">{error}</p>
          </div>
        )}

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
