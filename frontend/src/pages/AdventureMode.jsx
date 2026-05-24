// Adventure Mode page — mounts the Phaser game in a React container.
// Rendered via createPortal to avoid Layout's overflow-x:clip affecting
// position:fixed children (which would mis-place the Phaser canvas).

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { QuestPortalOverlay } from '../game/chore-portals/QuestPortalOverlay.jsx';
import { writeSave } from '../game/systems/SaveSystem.js';
import { levelFromXp } from '../game/data/WorldData.js';
// Eager import so destroyGame is available synchronously in the effect cleanup,
// eliminating the dynamic-import race that could leave a game instance un-destroyed
// when React StrictMode unmounts+remounts before the lazy import resolves.
import { createGame, destroyGame } from '../game/engine/GameInstance.js';

const HEADER_H = 34; // px — keep in sync with GameInstance height calc

export default function AdventureMode() {
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const containerRef = useRef(null);
  const gameRef      = useRef(null);

  const [activePortal, setActivePortal] = useState(null);
  const [gameData, setGameData]         = useState(null);
  const [gameReady, setGameReady]       = useState(false);

  const handleGameEvent = useCallback((event) => {
    if (event.type === 'portalEnter') {
      setActivePortal(event.zone);
      setGameData({ ...event.gameData });
      const scene = gameRef.current?.scene?.getScene('WorldScene');
      if (scene) {
        scene._paused = true;
        scene.physics.pause(); // stop enemy movement + contact-damage overlaps
      }
    }
  }, []);

  const handleExit = useCallback(() => { navigate('/'); }, [navigate]);

  // Full iOS-safe scroll lock — mirrors Modal.jsx to prevent page scrolling behind canvas.
  useEffect(() => {
    const alreadyLocked = document.body.style.position === 'fixed';
    const scrollY = alreadyLocked
      ? -parseInt(document.body.style.top || '0', 10)
      : window.scrollY;
    if (!alreadyLocked) {
      document.body.style.position = 'fixed';
      document.body.style.top      = `-${scrollY}px`;
      document.body.style.left     = '0';
      document.body.style.right    = '0';
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.position = '';
      document.body.style.top      = '';
      document.body.style.left     = '';
      document.body.style.right    = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !user) return;

    const game = createGame(containerRef.current.id, {
      userId:     String(user.id),
      userName:   user.username ?? user.display_name ?? 'Hero',
      isKid:      user.role === 'kid',   // gates backend progress-sync POST in WorldScene
      headerH:    HEADER_H,
      onExit:     handleExit,
      onComplete: handleGameEvent,
    });
    gameRef.current = game;
    setGameReady(true);

    // destroyGame is imported at the top level so this cleanup runs synchronously —
    // no dynamic-import race when React StrictMode unmounts before a lazy import resolves.
    return () => {
      destroyGame(gameRef.current);
      gameRef.current = null;
    };
  }, [user, handleExit, handleGameEvent]);

  function closePortal() {
    setActivePortal(null);
    const scene = gameRef.current?.scene?.getScene('WorldScene');
    if (scene) {
      scene._paused = false;
      scene.physics.resume(); // re-enable enemy movement + overlap detection
    }
  }

  function handleBuyWeapon({ weapon, cost }) {
    setGameData((prev) => {
      if (!prev || prev.coins < cost) return prev;
      const unlocked = [...new Set([...(prev.unlockedWeapons ?? ['broom']), weapon])];
      const next = { ...prev, coins: prev.coins - cost, weapon, unlockedWeapons: unlocked };
      writeSave({ ...next, userId: String(user?.id ?? 'preview') });
      const scene = gameRef.current?.scene?.getScene('WorldScene');
      if (scene) {
        scene.gameData.coins = next.coins;
        scene.gameData.weapon = weapon;
        scene.gameData.unlockedWeapons = unlocked;
        if (scene.player) scene.player.weapon = weapon;
      }
      return next;
    });
  }

  function handleEquipWeapon({ weapon }) {
    setGameData((prev) => {
      if (!prev || !(prev.unlockedWeapons ?? ['broom']).includes(weapon)) return prev;
      const next = { ...prev, weapon };
      writeSave({ ...next, userId: String(user?.id ?? 'preview') });
      const scene = gameRef.current?.scene?.getScene('WorldScene');
      if (scene) {
        scene.gameData.weapon = weapon;
        if (scene.player) scene.player.weapon = weapon;
      }
      return next;
    });
  }

  function handleChoreComplete({ assignment, xpGained, coinsGained }) {
    setGameData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, xp: prev.xp + xpGained, coins: prev.coins + coinsGained };
      writeSave({ ...next, userId: String(user?.id ?? 'preview') });
      const scene = gameRef.current?.scene?.getScene('WorldScene');
      if (scene) {
        scene.gameData.xp    = next.xp;
        scene.gameData.coins = next.coins;
        scene.sfx?.playChoreComplete();
        if (activePortal) {
          const currentLevel = scene.gameData.portalRestoreLevels?.[activePortal.id] ?? 0;
          const newLevel = Math.min(currentLevel + 1, 3);
          scene.gameData.portalRestoreLevels[activePortal.id] = newLevel;
          scene.portalMgr?.setRestoreLevel(activePortal.id, newLevel);
          scene.hud?.showFloatingText(
            scene.player?.x ?? 320, scene.player?.y ?? 240,
            `+${xpGained} XP  +${coinsGained}¢`, '#fcd860',
          );
        }
      }
      return next;
    });
  }

  const level = gameData ? levelFromXp(gameData.xp) : null;

  // Render via portal so position:fixed is relative to the true viewport,
  // not a Layout ancestor that has overflow-x:clip.
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      zIndex: 9999,
    }}>
      {/* Header bar */}
      <div style={{
        width: '100%',
        height: HEADER_H,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 8px',
        background: '#121212',
        borderBottom: '1px solid #2a2a2a',
        fontFamily: 'monospace', fontSize: 10, color: '#888',
        flexShrink: 0,
      }}>
        <span style={{ color: '#fcd860', fontWeight: 700 }}>⚔ Adventure Mode</span>
        {level !== null && (
          <span style={{ color: '#bcbcbc' }}>LV {level} · {gameData.coins} coins</span>
        )}
        {user?.role !== 'kid' && (
          <span style={{ color: '#f97316', fontSize: 9, background: '#1a0a00', border: '1px solid #7c2d12', borderRadius: 3, padding: '1px 5px' }}>
            PREVIEW — XP won't count on leaderboard
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#555' }}>
          SPACE = attack · ESC = pause
        </span>
        <button
          onClick={handleExit}
          style={{
            background: 'none', border: '1px solid #3a3a3a', borderRadius: 4,
            color: '#888', padding: '2px 8px', fontFamily: 'monospace',
            fontSize: 9, cursor: 'pointer',
          }}
        >Exit</button>
      </div>

      {/* Game canvas fills the remaining viewport */}
      <div style={{ position: 'relative', flex: 1, width: '100%', minHeight: 0 }}>
        <div
          id="adventure-game-container"
          ref={containerRef}
          style={{ position: 'absolute', inset: 0 }}
        />

        {!gameReady && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#121212', color: '#fcd860',
            fontFamily: 'monospace', fontSize: 14, zIndex: 10,
          }}>
            Loading Adventure Mode...
          </div>
        )}

        {activePortal && (
          <QuestPortalOverlay
            zone={activePortal}
            gameData={gameData}
            onClose={closePortal}
            onChoreComplete={handleChoreComplete}
            onBuyWeapon={handleBuyWeapon}
            onEquipWeapon={handleEquipWeapon}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
