// Quest portal popup — shown over the Phaser canvas when the player enters a portal.
// Fetches today's assignments from /api/calendar and lets the player mark them done
// (with photo proof when the quest requires it).
// Completing a chore calls POST /api/chores/{chore_id}/complete (same as the main app).
// XP and coins shown in-game are adventure currency that mirrors chore.points.

import { useState, useEffect, useRef } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { toLocalISO } from '../../utils/dates.js';
import { WEAPON_UPGRADES, WEAPON_STATS } from '../data/WorldData.js';

const DIFFICULTY_STYLES = {
  easy:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  hard:   'text-red-400 bg-red-500/10 border-red-500/30',
};

function DifficultyBadge({ difficulty }) {
  const d = (difficulty ?? 'easy').toLowerCase();
  const style = DIFFICULTY_STYLES[d] ?? 'text-muted bg-surface-raised border-border';
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${style}`}>
      {d}
    </span>
  );
}

// Starter broom card — shows as a reference so players have a baseline
const BROOM_CARD = { weapon: 'broom', name: 'Broom', desc: 'Your trusty starter weapon' };

const WEAPON_ICONS = { broom: '🧹', vacuum: '🌀', soap: '🧼', sponge: '🧽' };

// Stat bar — renders a mini progress bar for damage or range comparisons
function StatBar({ label, value, max, color }) {
  const pct = Math.min(value / max, 1);
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="w-8 text-[10px] font-medium text-muted">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-navy overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct * 100}%`, minWidth: pct > 0 ? 3 : 0 }}
        />
      </div>
      <span className="text-[10px] font-semibold text-cream/80">{value}</span>
    </div>
  );
}

// ── Weapon Shop (shown inside the Reward Castle portal) ───────────────────────
function WeaponShop({ gameData, onBuyWeapon, onEquipWeapon }) {
  const owned    = gameData?.unlockedWeapons ?? ['broom'];
  const equipped = gameData?.weapon ?? 'broom';
  const coins    = gameData?.coins ?? 0;

  // Prepend the broom as a non-purchasable starter card for context
  const allCards = [{ ...BROOM_CARD, isStarter: true }, ...WEAPON_UPGRADES];

  return (
    <div className="space-y-2">
      {allCards.map((u) => {
        const isStarter  = !!u.isStarter;
        const isOwned    = isStarter || owned.includes(u.weapon);
        const isEquipped = equipped === u.weapon;
        const canAfford  = coins >= (u.cost ?? 0);
        const stats      = WEAPON_STATS[u.weapon] ?? {};

        return (
          <div
            key={u.weapon}
            className={`rounded-lg border p-3 ${
              isEquipped
                ? 'bg-accent/5 border-accent/40'
                : 'bg-surface-raised border-border'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-navy text-lg shrink-0">
                {WEAPON_ICONS[u.weapon] ?? '⚔'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${isStarter && !isEquipped ? 'text-cream/70' : 'text-cream'}`}>
                    {u.name}
                  </span>
                  {isStarter && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-muted bg-navy">
                      Starter
                    </span>
                  )}
                  {isEquipped && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-accent-light bg-accent/10">
                      ✓ Equipped
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted mt-0.5">{u.desc}</div>
                <StatBar label="DMG" value={stats.damage} max={5}   color="bg-red-400" />
                <StatBar label="RNG" value={stats.range}  max={120} color="bg-sky-400" />
              </div>
              {!isOwned && (
                <span className="shrink-0 text-sm font-bold text-gold-light">🪙 {u.cost}</span>
              )}
            </div>

            {isOwned ? (
              !isEquipped && (
                <button
                  onClick={() => onEquipWeapon({ weapon: u.weapon })}
                  className="mt-2 px-4 py-1.5 rounded-md text-xs font-semibold text-accent-light bg-accent/10 border border-accent/40 hover:bg-accent/20 transition-colors cursor-pointer"
                >
                  Equip
                </button>
              )
            ) : (
              <button
                onClick={() => canAfford && onBuyWeapon({ weapon: u.weapon, cost: u.cost })}
                disabled={!canAfford}
                className={`mt-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  canAfford
                    ? 'text-navy bg-emerald hover:opacity-85 cursor-pointer'
                    : 'text-muted bg-surface-raised border border-border cursor-not-allowed'
                }`}
              >
                {canAfford ? `Buy for ${u.cost} coins` : `Need ${u.cost} coins`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Quest rewards ─────────────────────────────────────────────────────────────
// In-game XP/coins are adventure currency. The streak bonus only applies here —
// real XP is granted by the backend when a parent approves (no streak bonus).
const STREAK_BONUS_MIN = 3;
const STREAK_BONUS_MULT = 1.5;

function questReward(assignment, user) {
  const baseXp = assignment.chore?.points ?? 50;
  const streak = user?.role === 'kid' ? (user?.current_streak ?? 0) : 0;
  const streakBonus = streak >= STREAK_BONUS_MIN;
  const xp = streakBonus ? Math.round(baseXp * STREAK_BONUS_MULT) : baseXp;
  return { baseXp, xp, coins: Math.floor(xp / 10), streakBonus };
}

function requiresPhoto(assignment) {
  // Calendar entries carry the effective flag (per-kid rule overrides chore)
  return !!(assignment.requires_photo ?? assignment.chore?.requires_photo);
}

function CompletionPips({ count, max }) {
  if (max <= 1) return null;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${count} of ${max} done today`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i < count ? 'bg-emerald' : 'bg-navy border border-border-light'}`}
        />
      ))}
      <span className="ml-0.5 text-[10px] text-muted">{count}/{max} today</span>
    </span>
  );
}

function QuestCard({ assignment, user, busy, error, photo, onPickPhoto, onClearPhoto, onComplete }) {
  const chore = assignment.chore ?? {};
  const reward = questReward(assignment, user);
  const needsPhoto = requiresPhoto(assignment);
  const awaiting = assignment.status === 'completed';
  const maxCompletions = chore.max_completions_per_day ?? 1;
  const canSubmit = !busy && (!needsPhoto || !!photo);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        awaiting ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-surface-raised border-border'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${awaiting ? 'text-cream/70' : 'text-cream'}`}>
            {chore.icon && <span className="mr-1.5">{chore.icon}</span>}
            {chore.title ?? 'Chore Quest'}
          </div>
          {chore.description && !awaiting && (
            <div className="mt-0.5 text-xs text-muted">{chore.description}</div>
          )}
        </div>
        <DifficultyBadge difficulty={chore.difficulty ?? 'easy'} />
      </div>

      {awaiting ? (
        <div className="flex items-center gap-2 mt-2 text-xs font-medium text-emerald-400">
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-[10px]">✓</span>
          Done! Waiting for a parent to approve your XP.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-emerald-400 bg-emerald-500/10">
              +{reward.xp} XP{reward.streakBonus && ' 🔥'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-gold-light bg-amber-500/10">
              +{reward.coins} coins
            </span>
            <CompletionPips count={assignment.completion_count ?? 0} max={maxCompletions} />
          </div>

          {needsPhoto && (
            <div className="mt-2.5">
              {photo ? (
                <div className="flex items-center gap-2 p-1.5 rounded-md bg-navy border border-border">
                  <img src={photo.url} alt="Your photo proof" className="w-10 h-10 rounded object-cover" />
                  <span className="flex-1 min-w-0 truncate text-[11px] text-muted">{photo.file.name}</span>
                  <button
                    type="button"
                    onClick={onClearPhoto}
                    disabled={busy}
                    className="px-2 py-1 rounded text-[11px] text-muted hover:text-cream hover:bg-surface-raised cursor-pointer"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 py-2 rounded-md border border-dashed border-accent/40 bg-accent/5 text-xs font-medium text-accent-light hover:bg-accent/10 transition-colors cursor-pointer">
                  📷 Add a photo to prove it
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) onPickPhoto(file);
                    }}
                  />
                </label>
              )}
            </div>
          )}

          <button
            onClick={onComplete}
            disabled={!canSubmit}
            className={`mt-2.5 w-full px-3.5 py-2 rounded-md text-xs font-semibold transition-all ${
              canSubmit
                ? 'text-navy bg-emerald hover:opacity-90 active:scale-[0.98] cursor-pointer'
                : 'text-muted bg-surface border border-border cursor-not-allowed'
            }`}
          >
            {busy
              ? 'Sending…'
              : needsPhoto && !photo
                ? 'Add a photo first'
                : maxCompletions > 1
                  ? `✓ Done (${(assignment.completion_count ?? 0) + 1}/${maxCompletions})`
                  : '✓ I did it!'}
          </button>
        </>
      )}

      {error && (
        <div role="alert" className="mt-2 px-2.5 py-1.5 rounded-md text-[11px] text-red-300 bg-red-500/10 border border-red-500/30">
          {error}
        </div>
      )}
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────
export function QuestPortalOverlay({ zone, gameData, onClose, onChoreComplete, onBuyWeapon, onEquipWeapon }) {
  const { user }                  = useAuth();
  const [chores, setChores]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [doing, setDoing]         = useState(null);
  const [flash, setFlash]         = useState(null);
  const [errors, setErrors]       = useState({});   // assignment id → message
  const [photos, setPhotos]       = useState({});   // assignment id → { file, url }
  const flashTimer = useRef(null);
  const photosRef  = useRef(photos);
  photosRef.current = photos;

  // Clear the flash timer and release photo previews on unmount
  useEffect(() => () => {
    clearTimeout(flashTimer.current);
    Object.values(photosRef.current).forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  useEffect(() => {
    if (!zone || zone.isRewardShop) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);

    const today = toLocalISO();
    api('/api/calendar')
      .then((data) => {
        const todayAssignments = data.days?.[today] ?? [];
        const list = todayAssignments.filter((a) => {
          if (a.status !== 'pending' && a.status !== 'completed') return false;
          if (user && a.user_id !== user.id) return false;
          if (!zone.choreCategories?.length) return true;
          const catName = (a.chore?.category?.name ?? '').toLowerCase();
          return zone.choreCategories.some((c) => catName.includes(c.toLowerCase()));
        });
        // Open quests first, then ones already waiting for approval
        list.sort((a, b) => (a.status === 'completed') - (b.status === 'completed'));
        setChores(list.slice(0, 8));
      })
      .catch(() => { setChores([]); setLoadError(true); })
      .finally(() => setLoading(false));
  }, [zone, user, reloadKey]);

  function setPhoto(id, file) {
    setPhotos((prev) => {
      if (prev[id]) URL.revokeObjectURL(prev[id].url);
      const next = { ...prev };
      if (file) next[id] = { file, url: URL.createObjectURL(file) };
      else delete next[id];
      return next;
    });
    setErrors((prev) => ({ ...prev, [id]: null }));
  }

  async function handleComplete(assignment) {
    if (doing) return;
    setDoing(assignment.id);
    setErrors((prev) => ({ ...prev, [assignment.id]: null }));
    try {
      const photo = photos[assignment.id];
      let body;
      if (photo) {
        body = new FormData();
        body.append('file', photo.file);
      }
      const updated = await api(`/api/chores/${assignment.chore_id}/complete`, { method: 'POST', body });

      const { xp, coins, streakBonus } = questReward(assignment, user);
      clearTimeout(flashTimer.current);
      setFlash({ xp, coins, streakBonus, key: Date.now() });
      flashTimer.current = setTimeout(() => setFlash(null), 2000);
      onChoreComplete({ assignment, xpGained: xp, coinsGained: coins });

      // Multi-completion chores stay pending until the daily max is reached
      setChores((prev) => prev.map((c) => (c.id === assignment.id
        ? { ...c, status: updated?.status ?? 'completed', completion_count: updated?.completion_count ?? c.completion_count }
        : c)));
      setPhoto(assignment.id, null);
    } catch (err) {
      const msg = typeof err?.message === 'string' && err.message !== 'Request failed'
        ? err.message
        : "Couldn't send that quest. Try again!";
      setErrors((prev) => ({ ...prev, [assignment.id]: msg }));
    } finally {
      setDoing(null);
    }
  }

  if (!zone) return null;

  const zoneColorCss = `#${(zone.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
  const restoreLevel = gameData?.portalRestoreLevels?.[zone.id] ?? 0;
  const doneCount    = chores.filter((c) => c.status === 'completed').length;
  const hasStreak    = user?.role === 'kid' && (user?.current_streak ?? 0) >= STREAK_BONUS_MIN;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      style={{ fontFamily: 'var(--font-body)', animation: 'questfade 160ms ease-out' }}
      role="dialog"
      aria-modal="true"
      aria-label={zone.label}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      {/* Reward flash */}
      {flash && (
        <div
          key={flash.key}
          className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none z-10"
          style={{ animation: 'questflash 1.8s ease forwards' }}
          aria-live="polite"
        >
          <div className="text-3xl font-bold text-emerald-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            +{flash.xp} XP{flash.streakBonus && <span className="text-xl"> 🔥</span>}
          </div>
          <div className="mt-1 text-xl font-semibold text-gold-light drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            +{flash.coins} coins
          </div>
          {flash.streakBonus && (
            <div className="mt-0.5 text-xs font-medium text-orange-400">Streak bonus ×1.5!</div>
          )}
        </div>
      )}

      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-surface border border-border-light shadow-2xl"
        style={{ animation: 'questpop 220ms cubic-bezier(.2,.9,.3,1.2)', boxShadow: `0 0 0 1px ${zoneColorCss}22, 0 24px 48px -12px rgba(0,0,0,0.6)` }}
      >
        {/* Zone colour strip */}
        <div className="h-1 rounded-t-xl" style={{ background: `linear-gradient(90deg, ${zoneColorCss}, ${zoneColorCss}33)` }} />

        {/* Header */}
        <div className="sticky top-0 z-[1] flex items-start gap-3 p-4 pb-3 bg-surface border-b border-border">
          <span
            className="mt-1 w-3 h-3 rounded-full shrink-0"
            style={{ background: zoneColorCss, boxShadow: `0 0 8px ${zoneColorCss}66` }}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-cream leading-tight">{zone.label}</h2>
            <p className="text-xs text-muted mt-0.5">{zone.description}</p>
            {!zone.isRewardShop && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-muted">Zone health</span>
                <div className="flex gap-1" role="img" aria-label={`Zone health ${restoreLevel} of 4`}>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`w-4 h-1.5 rounded-full transition-colors ${i < restoreLevel ? 'bg-emerald' : 'bg-surface-raised'}`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted/70">
                  {restoreLevel === 0
                    ? 'complete chores to restore!'
                    : restoreLevel < 4 ? `${restoreLevel}/4 restored` : 'fully restored!'}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-cream hover:bg-surface-raised transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 pt-3">
          {/* Reward Castle — weapon shop */}
          {zone.isRewardShop && (
            <div>
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-surface-raised border border-border">
                <span className="text-sm font-medium text-cream">🏰 Weapon Shop</span>
                <span className="text-sm font-semibold text-gold-light">🪙 {gameData?.coins ?? 0}</span>
              </div>
              <WeaponShop
                gameData={gameData}
                onBuyWeapon={onBuyWeapon}
                onEquipWeapon={onEquipWeapon}
              />
              <p className="mt-3 text-center text-[11px] text-muted">
                Redeem coins for real rewards on the Rewards page!
              </p>
              <button
                onClick={onClose}
                className="block w-full mt-3 px-6 py-2.5 rounded-lg text-sm font-semibold text-navy bg-gold hover:bg-gold-light transition-colors cursor-pointer"
              >
                Continue Adventure
              </button>
            </div>
          )}

          {/* Quest list */}
          {!zone.isRewardShop && (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-xs font-medium text-muted uppercase tracking-wide">
                  Quests in this district
                </span>
                {hasStreak && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/30"
                    title="Bonus adventure XP in Adventure Mode. Real XP is added when a parent approves."
                  >
                    🔥 {user.current_streak}-day streak · 1.5× adventure XP
                  </span>
                )}
              </div>

              {!loading && chores.length > 0 && (
                <div className="mb-3">
                  <div className="flex justify-between text-[10px] text-muted mb-1">
                    <span>District progress</span>
                    <span>{doneCount}/{chores.length} done</span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-navy overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={chores.length}
                    aria-valuenow={doneCount}
                  >
                    <div
                      className="h-full rounded-full bg-emerald transition-[width] duration-500 ease-out"
                      style={{ width: `${(doneCount / chores.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {loading && (
                <div className="space-y-2" aria-busy="true" aria-label="Loading quests">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-[92px] rounded-lg bg-surface-raised border border-border animate-pulse" />
                  ))}
                </div>
              )}

              {!loading && loadError && (
                <div className="py-6 px-4 text-center rounded-lg border border-dashed border-red-500/30">
                  <p className="text-sm text-cream/80">Couldn't load quests.</p>
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium text-cream bg-surface-raised border border-border hover:border-border-light cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              )}

              {!loading && !loadError && chores.length === 0 && (
                <div className="py-8 px-4 text-center rounded-lg border border-dashed border-border-light">
                  {user?.role !== 'kid' ? (
                    <>
                      <p className="text-sm text-cream/80">Quests are assigned to kids, not parents.</p>
                      <p className="mt-1 text-xs text-muted">Log in as a kid to see active quests here.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-cream/80">No active quests here right now.</p>
                      <p className="mt-1 text-xs text-muted">Check back after the daily reset!</p>
                    </>
                  )}
                </div>
              )}

              {!loading && chores.length > 0 && doneCount === chores.length && (
                <div className="mb-3 px-3 py-2 rounded-lg text-center text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
                  🎉 District cleared! Your parent will approve your XP soon.
                </div>
              )}

              <div className="space-y-2">
                {chores.map((a) => (
                  <QuestCard
                    key={a.id}
                    assignment={a}
                    user={user}
                    busy={doing === a.id}
                    error={errors[a.id]}
                    photo={photos[a.id]}
                    onPickPhoto={(file) => setPhoto(a.id, file)}
                    onClearPhoto={() => setPhoto(a.id, null)}
                    onComplete={() => handleComplete(a)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes questflash {
          0%   { opacity: 1; transform: translate(-50%,-50%); }
          80%  { opacity: 1; transform: translate(-50%,-80%); }
          100% { opacity: 0; transform: translate(-50%,-100%); }
        }
        @keyframes questfade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes questpop {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="questpop"], [style*="questfade"], [style*="questflash"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
