import { useEffect, useRef } from 'react';

/**
 * Refetch page data when WebSocket events arrive, coalescing bursts.
 *
 * Broadcasts often come in clusters (auto-approve clears several quests,
 * a verify sends chore_verified + data_changed), and every connected client
 * refetches on each one. Debouncing turns a burst into a single refetch.
 * Listeners that must react to each individual event (toasts, emotes)
 * should keep their own `ws:message` handler instead.
 */
export function useWsRefetch(refetch, delay = 250) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    let timer;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refetchRef.current(), delay);
    };
    window.addEventListener('ws:message', handler);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('ws:message', handler);
    };
  }, [delay]);
}
