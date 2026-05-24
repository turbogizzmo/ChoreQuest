// Quest portal popup — shown over the Phaser canvas when the player enters a portal.
// Fetches today's pending assignments from /api/calendar and lets the player mark them done.
// Completing a chore calls POST /api/chores/{chore_id}/complete (same as the main app).
// XP and coins shown in-game are adventure currency that mirrors chore.points.

import { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { toLocalISO } from '../../utils/dates.js';
import { WEAPON_UPGRADES, WEAPON_STATS } from '../data/WorldData.js';

const DIFFICULTY_COLORS = {
  easy:   '#58d854',
  medium: '#fcd860',
  hard:   '#f87858',
};

function DifficultyBadge({ difficulty }) {
  const d = (difficulty ?? 'easy').toLowerCase();
  const color = DIFFICULTY_COLORS[d] ?? '#bcbcbc';
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 10, color,
      border: `1px solid ${color}`, borderRadius: 3,
      padding: '1px 5px', textTransform: 'uppercase',
    }}>
      {d}
    </span>
  );
}

// ── Weapon Shop (shown inside the Reward Castle portal) ───────────────────────
function WeaponShop({ gameData, onBuyWeapon, onEquipWeapon }) {
  const owned    = gameData?.unlockedWeapons ?? ['broom'];
  const equipped = gameData?.weapon ?? 'broom';
  const coins    = gameData?.coins ?? 0;

  return (
    <div>
      <div style={{ fontSize: 9, color: '#888', marginBottom: 10 }}>
        Your coins: <strong style={{ color: '#fcd860' }}>{coins}</strong>
      </div>
      {WEAPON_UPGRADES.map((u) => {
        const isOwned    = owned.includes(u.weapon);
        const isEquipped = equipped === u.weapon;
        const canAfford  = coins >= u.cost;
        const stats      = WEAPON_STATS[u.weapon] ?? {};

        return (
          <div key={u.weapon} style={{
            background: isEquipped ? '#1a2a1a' : '#252525',
            border: `1px solid ${isEquipped ? '#58d854' : '#333'}`,
            borderRadius: 6, padding: '10px 12px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 600 }}>
                  {u.name}
                  {isEquipped && (
                    <span style={{ marginLeft: 6, fontSize: 9, color: '#58d854' }}>✓ EQUIPPED</span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>{u.desc}</div>
                <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                  <span style={{ color: '#f87858' }}>DMG {stats.damage}</span>
                  {' · '}
                  <span style={{ color: '#6888fc' }}>RNG {stats.range}</span>
                </div>
              </div>
              {!isOwned && (
                <span style={{ fontSize: 11, color: '#fcd860', fontWeight: 700 }}>
                  {u.cost}¢
                </span>
              )}
            </div>

            {isOwned ? (
              !isEquipped && (
                <button
                  onClick={() => onEquipWeapon({ weapon: u.weapon })}
                  style={{
                    padding: '5px 12px', background: '#334433', border: '1px solid #58d854',
                    borderRadius: 4, color: '#58d854', fontFamily: 'monospace',
                    fontSize: 10, cursor: 'pointer', fontWeight: 700,
                  }}
                >
                  Equip
                </button>
              )
            ) : (
              <button
                onClick={() => canAfford && onBuyWeapon({ weapon: u.weapon, cost: u.cost })}
                disabled={!canAfford}
                style={{
                  padding: '5px 12px',
                  background: canAfford ? '#10b981' : '#333',
                  border: 'none', borderRadius: 4,
                  color: canAfford ? '#000' : '#555',
                  fontFamily: 'monospace', fontSize: 10,
                  cursor: canAfford ? 'pointer' : 'not-allowed', fontWeight: 700,
                }}
              >
                {canAfford ? `Buy for ${u.cost}¢` : `Need ${u.cost}¢`}
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

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.72)',
      zIndex: 50,
      fontFamily: 'monospace',
    }}>
      {/* Reward flash */}
      {flash && (
        <div style={{
          position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
          textAlign: 'center', pointerEvents: 'none',
          animation: 'fadeup 1.8s ease forwards',
        }}>
          <div style={{ fontSize: 28, color: '#58d854', textShadow: '0 2px 8px #000' }}>
            +{flash.xp} XP{flash.streakBonus && <span style={{ fontSize: 20 }}> 🔥</span>}
          </div>
          <div style={{ fontSize: 18, color: '#fcd860', marginTop: 4 }}>
            +{flash.coins} Coins
          </div>
          {flash.streakBonus && (
            <div style={{ fontSize: 11, color: '#ff8800', marginTop: 2 }}>Streak bonus ×1.5!</div>
          )}
        </div>
      )}

      <div style={{
        background: '#1a1a1a',
        border: '2px solid #3a3a3a',
        borderRadius: 8,
        padding: 20,
        width: Math.min(380, window.innerWidth - 32),
        maxHeight: '80vh',
        overflowY: 'auto',
        position: 'relative',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: zoneColorCss }} />
          <div>
            <div style={{ fontSize: 14, color: '#fcd860', fontWeight: 700 }}>{zone.label}</div>
            <div style={{ fontSize: 9, color: '#888' }}>{zone.description}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: '#888', fontSize: 16, cursor: 'pointer',
            }}
          >✕</button>
        </div>

        {/* Reward Castle — weapon shop */}
        {zone.isRewardShop && (
          <div>
            <div style={{ color: '#bcbcbc', fontSize: 11, textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>🏰</div>
              <div>Coins: <strong style={{ color: '#fcd860' }}>{gameData?.coins ?? 0}</strong></div>
            </div>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 8 }}>⚔ Weapon Shop</div>
            <WeaponShop
              gameData={gameData}
              onBuyWeapon={onBuyWeapon}
              onEquipWeapon={onEquipWeapon}
            />
            <div style={{ marginTop: 8, fontSize: 9, color: '#666', textAlign: 'center' }}>
              Redeem coins for real rewards on the Rewards page!
            </div>
            <button
              onClick={onClose}
              style={{
                display: 'block', margin: '12px auto 0', padding: '8px 24px',
                background: '#d4a017', border: 'none', borderRadius: 4,
                color: '#000', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
              }}
            >
              Continue Adventure
            </button>
          </div>
        )}

        {/* Quest list */}
        {!zone.isRewardShop && (
          <>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 8 }}>
              Active quests in this district:
              {user?.role === 'kid' && (user?.current_streak ?? 0) > 2 && (
                <span style={{ marginLeft: 8, color: '#ff8800' }}>
                  🔥 {user.current_streak}-day streak → 1.5× XP bonus!
                </span>
              )}
            </div>

            {loading && (
              <div style={{ color: '#666', fontSize: 10, textAlign: 'center', padding: 16 }}>
                Loading quests...
              </div>
            )}

            {!loading && chores.length === 0 && (
              <div style={{
                color: '#666', fontSize: 10, textAlign: 'center', padding: 16,
                border: '1px dashed #333', borderRadius: 6,
              }}>
                {user?.role !== 'kid' ? (
                  <>
                    Quests are assigned to kids, not parents.<br />
                    <span style={{ fontSize: 9, color: '#555' }}>Log in as a kid to see active quests here.</span>
                  </>
                ) : (
                  <>
                    No active quests here right now.<br />
                    <span style={{ fontSize: 9, color: '#555' }}>Check back after the daily reset!</span>
                  </>
                )}
              </div>
            )}

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
                <div
                  key={a.id}
                  style={{
                    background: '#252525', border: '1px solid #333', borderRadius: 6,
                    padding: '10px 12px', marginBottom: 8,
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 600 }}>
                        {chore.title ?? 'Chore Quest'}
                        {hasStreak && <span style={{ marginLeft: 5, fontSize: 10 }}>🔥</span>}
                      </div>
                      {chore.description && (
                        <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                          {chore.description}
                        </div>
                      )}
                    </div>
                    <DifficultyBadge difficulty={diff} />
                  </div>

                  <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#888' }}>
                    <span style={{ color: '#58d854' }}>+{xp} XP{hasStreak && ' ×1.5'}</span>
                    <span style={{ color: '#fcd860' }}>+{coins} coins</span>
                  </div>

                  <button
                    onClick={() => handleComplete(a)}
                    disabled={isDoing}
                    style={{
                      padding: '6px 12px',
                      background: isDoing ? '#333' : '#10b981',
                      border: 'none', borderRadius: 4,
                      color: isDoing ? '#666' : '#000',
                      fontFamily: 'monospace', fontSize: 10,
                      cursor: isDoing ? 'not-allowed' : 'pointer',
                      fontWeight: 700, transition: 'background 0.15s',
                    }}
                  >
                    {isDoing ? 'Completing...' : '✓ Mark Complete'}
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeup {
          0%   { opacity: 1; transform: translate(-50%,-50%); }
          80%  { opacity: 1; transform: translate(-50%,-80%); }
          100% { opacity: 0; transform: translate(-50%,-100%); }
        }
      `}</style>
    </div>
  );
}
