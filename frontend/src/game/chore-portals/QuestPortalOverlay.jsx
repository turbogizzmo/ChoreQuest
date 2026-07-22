// Quest portal popup — shown over the Phaser canvas when the player enters a portal.
// Fetches today's pending assignments from /api/calendar and lets the player mark them done.
// Completing a chore calls POST /api/chores/{chore_id}/complete (same as the main app).
// XP and coins shown in-game are adventure currency that mirrors chore.points.

import { useState, useEffect } from 'react';
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

// ── Main overlay ──────────────────────────────────────────────────────────────
export function QuestPortalOverlay({ zone, gameData, onClose, onChoreComplete, onBuyWeapon, onEquipWeapon }) {
  const { user }              = useAuth();
  const [chores, setChores]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [doing, setDoing]     = useState(null);
  const [flash, setFlash]     = useState(null);

  useEffect(() => {
    if (!zone || zone.isRewardShop) { setLoading(false); return; }
    setLoading(true);

    const today = toLocalISO();
    api('/api/calendar')
      .then((data) => {
        const todayAssignments = data.days?.[today] ?? [];
        const list = todayAssignments.filter((a) => {
          if (a.status !== 'pending') return false;
          if (user && a.user_id !== user.id) return false;
          if (!zone.choreCategories?.length) return true;
          const catName = (a.chore?.category?.name ?? '').toLowerCase();
          return zone.choreCategories.some((c) => catName.includes(c.toLowerCase()));
        });
        setChores(list.slice(0, 6));
      })
      .catch(() => setChores([]))
      .finally(() => setLoading(false));
  }, [zone, user]);

  async function handleComplete(assignment) {
    setDoing(assignment.id);
    try {
      await api(`/api/chores/${assignment.chore_id}/complete`, { method: 'POST' });

      // Streak bonus: kids only — parents in preview mode have streaks from their own
      // chore activity which has no gameplay meaning here, so skip the bonus for them.
      const streak      = user?.role === 'kid' ? (user?.current_streak ?? 0) : 0;
      const baseXp      = assignment.chore?.points ?? 50;
      const xpGained    = streak > 2 ? Math.round(baseXp * 1.5) : baseXp;
      const coinsGained = Math.floor(xpGained / 10);

      setFlash({ xp: xpGained, coins: coinsGained, streakBonus: streak > 2 });
      onChoreComplete({ assignment, xpGained, coinsGained });
      setChores((prev) => prev.filter((c) => c.id !== assignment.id));
      setTimeout(() => setFlash(null), 2000);
    } catch (err) {
      console.warn('[QuestPortal] complete failed', err);
    } finally {
      setDoing(null);
    }
  }

  if (!zone) return null;

  const zoneColorCss = `#${(zone.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
  const restoreLevel = gameData?.portalRestoreLevels?.[zone.id] ?? 0;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* Reward flash */}
      {flash && (
        <div
          className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none z-10"
          style={{ animation: 'questflash 1.8s ease forwards' }}
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

      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-surface border border-border-light shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 flex items-start gap-3 p-4 pb-3 bg-surface border-b border-border">
          <span
            className="mt-0.5 w-3 h-3 rounded-full shrink-0"
            style={{ background: zoneColorCss, boxShadow: `0 0 8px ${zoneColorCss}66` }}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-cream leading-tight">{zone.label}</h2>
            <p className="text-xs text-muted mt-0.5">{zone.description}</p>
            {!zone.isRewardShop && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-muted">Zone health</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`w-4 h-1.5 rounded-full ${i < restoreLevel ? 'bg-emerald' : 'bg-surface-raised'}`}
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
                  Active quests in this district
                </span>
                {user?.role === 'kid' && (user?.current_streak ?? 0) > 2 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/30">
                    🔥 {user.current_streak}-day streak · 1.5× XP
                  </span>
                )}
              </div>

              {loading && (
                <div className="py-8 text-center text-xs text-muted">Loading quests…</div>
              )}

              {!loading && chores.length === 0 && (
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

              <div className="space-y-2">
                {chores.map((a) => {
                  const chore   = a.chore ?? {};
                  const baseXp  = chore.points ?? 50;
                  const streak  = user?.role === 'kid' ? (user?.current_streak ?? 0) : 0;
                  const xp      = streak > 2 ? Math.round(baseXp * 1.5) : baseXp;
                  const coins   = Math.floor(xp / 10);
                  const diff    = chore.difficulty ?? 'easy';
                  const isDoing = doing === a.id;
                  const hasStreak = streak > 2;

                  return (
                    <div key={a.id} className="rounded-lg bg-surface-raised border border-border p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-cream">
                            {chore.title ?? 'Chore Quest'}
                            {hasStreak && <span className="ml-1.5 text-xs">🔥</span>}
                          </div>
                          {chore.description && (
                            <div className="mt-0.5 text-xs text-muted">{chore.description}</div>
                          )}
                        </div>
                        <DifficultyBadge difficulty={diff} />
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-emerald-400 bg-emerald-500/10">
                          +{xp} XP{hasStreak && ' ×1.5'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-gold-light bg-amber-500/10">
                          +{coins} coins
                        </span>
                        <button
                          onClick={() => handleComplete(a)}
                          disabled={isDoing}
                          className={`ml-auto px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                            isDoing
                              ? 'text-muted bg-surface border border-border cursor-not-allowed'
                              : 'text-navy bg-emerald hover:opacity-85 cursor-pointer'
                          }`}
                        >
                          {isDoing ? 'Completing…' : '✓ Mark complete'}
                        </button>
                      </div>
                    </div>
                  );
                })}
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
      `}</style>
    </div>
  );
}
