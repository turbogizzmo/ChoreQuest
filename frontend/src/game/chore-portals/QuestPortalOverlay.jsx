// Quest portal popup — shown over the Phaser canvas when the player enters a portal.
// Fetches real chores from the API and lets the player accept/complete them.

import { useState, useEffect } from 'react';
import { api } from '../../api/client.js';

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

export function QuestPortalOverlay({ zone, gameData, onClose, onChoreComplete }) {
  const [chores, setChores]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [doing, setDoing]     = useState(null);
  const [flash, setFlash]     = useState(null);

  useEffect(() => {
    if (!zone) return;
    setLoading(true);
    api('/api/chores/assignments?status=pending')
      .then((data) => {
        const list = (data ?? []).filter((a) => {
          if (!zone.choreCategories?.length) return true;
          const cat = (a.category ?? a.chore?.category ?? '').toLowerCase();
          return zone.choreCategories.some((c) => cat.includes(c.toLowerCase()));
        });
        setChores(list.slice(0, 6));
      })
      .catch(() => setChores([]))
      .finally(() => setLoading(false));
  }, [zone]);

  async function handleComplete(assignment) {
    setDoing(assignment.id);
    try {
      await api(`/api/chores/assignments/${assignment.id}/complete`, { method: 'POST' });
      const xpGained    = assignment.xp_reward ?? assignment.chore?.xp_value ?? 50;
      const coinsGained = Math.floor(xpGained / 10);
      setFlash({ xp: xpGained, coins: coinsGained });
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

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.72)',
      zIndex: 50,
      fontFamily: 'monospace',
    }}>
      {/* Flash reward */}
      {flash && (
        <div style={{
          position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
          textAlign: 'center', pointerEvents: 'none',
          animation: 'fadeup 1.8s ease forwards',
        }}>
          <div style={{ fontSize: 28, color: '#58d854', textShadow: '0 2px 8px #000' }}>
            +{flash.xp} XP
          </div>
          <div style={{ fontSize: 18, color: '#fcd860', marginTop: 4 }}>
            +{flash.coins} Coins
          </div>
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
          <div style={{
            width: 12, height: 12, borderRadius: 2,
            background: `#${zone.color?.toString(16).padStart(6,'0') ?? 'ffffff'}`,
          }} />
          <div>
            <div style={{ fontSize: 14, color: '#fcd860', fontWeight: 700 }}>
              {zone.label}
            </div>
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

        {/* Reward Castle special case */}
        {zone.isRewardShop && (
          <div style={{ color: '#bcbcbc', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>🏰</div>
            <div>Coins: <strong style={{ color: '#fcd860' }}>{gameData?.coins ?? 0}</strong></div>
            <div style={{ marginTop: 8, fontSize: 9, color: '#666' }}>
              Visit the Rewards page in ChoreQuest to redeem your coins for prizes!
            </div>
            <button
              onClick={onClose}
              style={{
                marginTop: 12, padding: '8px 24px',
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
                No active quests here right now.<br />
                <span style={{ fontSize: 9, color: '#555' }}>Check back after the daily reset!</span>
              </div>
            )}

            {chores.map((a) => {
              const chore = a.chore ?? a;
              const xp    = a.xp_reward ?? chore.xp_value ?? 50;
              const coins = Math.floor(xp / 10);
              const diff  = chore.difficulty ?? 'easy';
              const isDoing = doing === a.id;

              return (
                <div
                  key={a.id}
                  style={{
                    background: '#252525',
                    border: '1px solid #333',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 600 }}>
                        {chore.name ?? chore.title ?? 'Chore Quest'}
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
                    <span style={{ color: '#58d854' }}>+{xp} XP</span>
                    <span style={{ color: '#fcd860' }}>+{coins} coins</span>
                    {chore.allowance_value > 0 && (
                      <span style={{ color: '#14b8a6' }}>${chore.allowance_value.toFixed(2)}</span>
                    )}
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
                      fontWeight: 700,
                      transition: 'background 0.15s',
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
