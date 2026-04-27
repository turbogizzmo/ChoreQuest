import { useState, useEffect, useRef } from 'react';

/**
 * Full-screen Windows-Update-style overlay shown when an in-app update is triggered.
 *
 * Flow:
 *  1. Listen for the custom 'app:update-triggered' event dispatched by Settings.jsx.
 *  2. Fade the app out and show the overlay with a spinning ring + percentage counter.
 *  3. Fake-count from 0 → ~80 % over ~90 seconds (covers the container restart time).
 *  4. Poll /api/health every 4 s.  Once the returned `version` differs from the one
 *     that was running when the update started, snap to 100 % and reload.
 *  5. Hard-safety: if the app hasn't come back after 5 minutes, show a manual-reload
 *     button so the user is never stuck.
 */

const POLL_INTERVAL_MS  = 4_000;
const SAFETY_TIMEOUT_MS = 5 * 60_000;

// Eased fake-progress: rises fast at first, then slows to a crawl near 80 %.
function fakePercent(elapsedMs) {
  const t = Math.min(elapsedMs / 90_000, 1); // normalise to [0, 1] over 90 s
  return Math.round(80 * (1 - Math.pow(1 - t, 2.5)));
}

// Spinning-dots row — three dots that pulse in sequence (Windows 11 style).
function SpinDots() {
  return (
    <div className="flex items-center justify-center gap-3 my-6">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-3 h-3 rounded-full bg-white/80"
          style={{
            animation: `win-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// Large ring spinner (mimics the Windows Update circular progress).
function RingSpinner({ percent }) {
  const r  = 54;
  const cx = 64;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent / 100);

  return (
    <div className="relative flex items-center justify-center w-32 h-32 mx-auto">
      <svg className="absolute inset-0 -rotate-90" width="128" height="128" viewBox="0 0 128 128">
        {/* Track */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        {/* Progress arc */}
        <circle
          cx={cx} cy={cx} r={r}
          fill="none"
          stroke="white"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      {/* Percentage number in the middle */}
      <span className="text-2xl font-light text-white tabular-nums select-none">
        {percent}%
      </span>
    </div>
  );
}

export default function UpdateOverlay() {
  const [visible, setVisible]     = useState(false);
  const [percent, setPercent]     = useState(0);
  const [done, setDone]           = useState(false);
  const [timedOut, setTimedOut]   = useState(false);
  const startVersionRef           = useRef(null);
  const startTimeRef              = useRef(null);
  const pollTimerRef              = useRef(null);
  const safetyTimerRef            = useRef(null);
  const progressTimerRef          = useRef(null);

  // ------------------------------------------------------------------
  // Listen for the trigger event from Settings.jsx
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      startVersionRef.current = e.detail?.currentVersion ?? null;
      startTimeRef.current    = Date.now();
      setPercent(0);
      setDone(false);
      setTimedOut(false);
      setVisible(true);
    };
    window.addEventListener('app:update-triggered', handler);
    return () => window.removeEventListener('app:update-triggered', handler);
  }, []);

  // ------------------------------------------------------------------
  // While visible: fake progress + poll health
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible || done) return;

    // Fake progress ticker — update every 800 ms
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setPercent(fakePercent(elapsed));
    }, 800);

    // Health poller
    const poll = async () => {
      try {
        const res  = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        const newVersion = data?.version;
        if (
          newVersion &&
          startVersionRef.current &&
          newVersion !== startVersionRef.current
        ) {
          // New version is live — finish up
          clearInterval(progressTimerRef.current);
          clearInterval(pollTimerRef.current);
          clearTimeout(safetyTimerRef.current);
          setPercent(100);
          setDone(true);
          setTimeout(() => window.location.reload(), 1800);
        }
      } catch {
        // Server is still restarting — ignore and keep polling
      }
    };
    poll(); // immediate first check
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Safety escape hatch
    safetyTimerRef.current = setTimeout(() => {
      clearInterval(progressTimerRef.current);
      clearInterval(pollTimerRef.current);
      setTimedOut(true);
    }, SAFETY_TIMEOUT_MS);

    return () => {
      clearInterval(progressTimerRef.current);
      clearInterval(pollTimerRef.current);
      clearTimeout(safetyTimerRef.current);
    };
  }, [visible, done]);

  if (!visible) return null;

  return (
    <>
      {/* Global keyframe injected once */}
      <style>{`
        @keyframes win-dot {
          0%, 60%, 100% { opacity: 0.15; transform: scale(0.8); }
          30%            { opacity: 1;    transform: scale(1.2); }
        }
        @keyframes win-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Full-screen overlay — sits above everything */}
      <div
        className="fixed inset-0 z-[99999] flex flex-col items-center justify-between py-16 px-8 text-white select-none"
        style={{
          background: 'linear-gradient(160deg, #0f1729 0%, #0a0e1a 100%)',
          animation: 'win-fade-in 0.6s ease forwards',
        }}
      >
        {/* Top: branding */}
        <div className="flex flex-col items-center gap-2 mt-8">
          <span className="text-4xl">⚔️</span>
          <p className="text-white/50 text-sm tracking-widest uppercase">
            ChoreQuest
          </p>
        </div>

        {/* Middle: ring + status */}
        <div className="flex flex-col items-center gap-4">
          {done ? (
            // Completion state
            <div className="flex flex-col items-center gap-4">
              <span className="text-6xl animate-bounce">✅</span>
              <p className="text-white text-xl font-light">Update complete!</p>
              <p className="text-white/50 text-sm">Reloading the realm…</p>
            </div>
          ) : timedOut ? (
            // Safety timeout state
            <div className="flex flex-col items-center gap-5 text-center">
              <p className="text-white text-lg font-light">Taking longer than expected…</p>
              <p className="text-white/50 text-sm max-w-xs">
                The container may still be restarting. Try reloading manually.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-6 py-2.5 rounded-md bg-white/10 hover:bg-white/20
                           text-white text-sm font-medium transition-colors border border-white/20"
              >
                Reload now
              </button>
            </div>
          ) : (
            // In-progress state
            <>
              <RingSpinner percent={percent} />
              <SpinDots />
              <p className="text-white text-xl font-light tracking-wide">
                Working on updates
              </p>
              <p className="text-white/40 text-sm">
                {percent < 30
                  ? 'Pulling latest build…'
                  : percent < 60
                  ? 'Rebuilding container…'
                  : percent < 80
                  ? 'Almost there…'
                  : 'Waiting for restart…'}
              </p>
            </>
          )}
        </div>

        {/* Bottom: Windows-style disclaimer */}
        <p className="text-white/25 text-xs text-center">
          {done || timedOut
            ? ''
            : "Don't close this window. Your quests will be back shortly."}
        </p>
      </div>
    </>
  );
}
