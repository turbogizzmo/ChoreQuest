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

const HEADER_H = 44; // px — keep in sync with GameInstance height calc

export default function AdventureMode() {
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const containerRef = useRef(null);
  const gameRef      = useRef(null);

  const [activePortal, setActivePortal] = useState(null);
  const [gameData, setGameData]         = useState(null);
  const [gameReady, setGameReady]       = useState(false);

  const handleGameEvent = useCallback((event) => {
    if (event.type === 'sceneReady') {
      // WorldScene.create() has finished — canvas is live, hide the loading splash
      setGameReady(true);
      return;
    }
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
    // Reset on every (re)mount: under React StrictMode the effect runs twice,
    // and a stale `true` from the first (destroyed) game instance would hide
    // the loading splash while the second instance is still booting.
    setGameReady(false);
    const mobile = window.innerWidth <= 480;

    const game = createGame(containerRef.current.id, {
      userId:     String(user.id),
      userName:   user.username ?? user.display_name ?? 'Hero',
      avatarConfig: user.avatar_config ?? null,
      isKid:      user.role === 'kid',   // gates backend progress-sync POST in WorldScene
      headerH:    mobile ? 0 : HEADER_H, // no React header on mobile — full canvas height
      onExit:     handleExit,
      onComplete: handleGameEvent,
    });
    gameRef.current = game;
    // setGameReady is triggered by the 'sceneReady' event from WorldScene.create()
    // so the loading splash stays visible until the canvas is actually live.

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
      // Buy only unlocks the weapon — the player must press Equip to switch.
      // Auto-equipping on purchase bypasses the Equip button shown in the shop UI.
      const next = { ...prev, coins: prev.coins - cost, unlockedWeapons: unlocked };
      writeSave({ ...next, userId: String(user?.id ?? 'preview') });
      const scene = gameRef.current?.scene?.getScene('WorldScene');
      if (scene) {
        scene.gameData.coins = next.coins;
        scene.gameData.unlockedWeapons = unlocked;
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
          // Guard: older/partial saves may not have this field yet
          scene.gameData.portalRestoreLevels ||= {};
          const currentLevel = scene.gameData.portalRestoreLevels[activePortal.id] ?? 0;
          const newLevel = Math.min(currentLevel + 1, 4);
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

  // On narrow mobile screens (≤480 px) collapse the header to save vertical space.
  // The Exit button is instead rendered as a small overlay chip inside the canvas area.
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 480;

  // Render via portal so position:fixed is relative to the true viewport,
  // not a Layout ancestor that has overflow-x:clip.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center bg-black"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* Header bar — hidden on narrow mobile, replaced by canvas overlay */}
      {!isMobile && (
      <div
        className="w-full shrink-0 flex items-center gap-3 px-3 bg-navy border-b border-border"
        style={{ height: HEADER_H }}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-cream">
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/15 text-accent-light text-xs">⚔</span>
          Adventure Mode
        </span>
        {level !== null && (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-surface-raised border border-border text-gold-light font-semibold">
              LV {level}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-surface-raised border border-border text-gold-light font-semibold">
              🪙 {gameData.coins}
            </span>
          </span>
        )}
        {user?.role !== 'kid' && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30">
            Preview — XP won't count on leaderboard
          </span>
        )}
        <span className="ml-auto hidden sm:flex items-center gap-1.5 text-[11px] text-muted">
          <kbd className="px-1.5 py-0.5 rounded bg-surface-raised border border-border text-[10px]">Space</kbd>
          attack
          <span className="text-border-light">·</span>
          <kbd className="px-1.5 py-0.5 rounded bg-surface-raised border border-border text-[10px]">Esc</kbd>
          pause
        </span>
        <button
          onClick={handleExit}
          className="px-3 py-1 rounded-md text-xs font-medium text-cream bg-surface-raised border border-border hover:border-border-light hover:bg-border transition-colors cursor-pointer"
        >
          Exit
        </button>
      </div>
      )}

      {/* Game canvas fills the remaining viewport */}
      <div style={{ position: 'relative', flex: 1, width: '100%', minHeight: 0 }}>
        <div
          id="adventure-game-container"
          ref={containerRef}
          style={{ position: 'absolute', inset: 0 }}
        />

        {/* Mobile-only floating Exit chip — overlays the canvas top-right */}
        {isMobile && (
          <button
            onClick={handleExit}
            className="absolute top-2 right-2 z-20 px-3 py-1.5 rounded-full text-xs font-medium text-cream bg-navy/85 backdrop-blur-sm border border-border-light cursor-pointer"
          >
            ✕ Exit
          </button>
        )}

        {!gameReady && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-navy">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 text-2xl">
              ⚔
            </div>
            <div className="text-center">
              <div className="text-base font-semibold text-cream">Adventure Mode</div>
              <div className="mt-1 text-xs text-muted">Building your world…</div>
            </div>
            <div className="w-40 h-1 rounded-full bg-surface-raised overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-accent animate-[advloader_1.1s_ease-in-out_infinite]" />
            </div>
            <style>{`
              @keyframes advloader {
                0%   { transform: translateX(-120%); }
                100% { transform: translateX(440%); }
              }
            `}</style>
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
