import { useEffect, useRef, useState } from 'react';
import { getAccessToken, ensureToken } from '../api/client';

export function useWebSocket(userId, onMessage) {
  const wsRef = useRef(null);
  const reconnectTimeout = useRef(null);
  const retryCount = useRef(0);
  // Latest handler in a ref so a new callback identity never tears down the socket
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;
    // Set on cleanup so this effect's socket can't schedule a reconnect after
    // unmount / logout / user switch (closing it fires onclose).
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
      retryCount.current += 1;
      reconnectTimeout.current = setTimeout(() => {
        // Refresh access token before reconnecting (it may have expired)
        ensureToken()
          .catch((err) => {
            // Session really gone — log out like api() does instead of
            // retrying forever. Other failures (server down) just retry.
            if (err?.status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
          })
          .finally(connect);
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      const token = getAccessToken();
      // No token yet (e.g. refresh failed while the server was restarting):
      // keep retrying rather than giving up for the rest of the session.
      if (!token) {
        scheduleReconnect();
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${userId}?token=${token}`);

      ws.onopen = () => {
        // Anything broadcast while we were disconnected was missed — tell
        // listeners to refetch.
        if (retryCount.current > 0) {
          onMessageRef.current?.({ type: 'data_changed', data: { entity: 'resync' } });
        }
        setConnected(true);
        retryCount.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => ws.close();
      wsRef.current = ws;
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
      wsRef.current = null;
      retryCount.current = 0;
    };
  }, [userId]);

  return { connected };
}
