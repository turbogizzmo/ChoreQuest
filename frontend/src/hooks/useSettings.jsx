import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const SettingsContext = createContext({
  leaderboard_enabled: true,
  spin_wheel_enabled: true,
  spin_requires_verification: true,
  chore_trading_enabled: true,
  grace_period_days: 1,
});

export function SettingsProvider({ children }) {
  const [features, setFeatures] = useState({
    leaderboard_enabled: true,
    spin_wheel_enabled: true,
    spin_requires_verification: true,
    chore_trading_enabled: true,
    grace_period_days: 1,
  });

  const fetchFeatures = useCallback(async () => {
    try {
      const data = await api('/api/admin/settings/features');
      setFeatures({
        leaderboard_enabled: data.leaderboard_enabled !== 'false',
        spin_wheel_enabled: data.spin_wheel_enabled !== 'false',
        spin_requires_verification: data.spin_requires_verification !== 'false',
        chore_trading_enabled: data.chore_trading_enabled !== 'false',
        grace_period_days: parseInt(data.grace_period_days ?? '1', 10),
      });
    } catch {
      // If fetch fails, keep defaults (all enabled)
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  // Re-fetch when settings are saved (listen for custom event)
  useEffect(() => {
    const handler = () => fetchFeatures();
    window.addEventListener('settings:updated', handler);
    return () => window.removeEventListener('settings:updated', handler);
  }, [fetchFeatures]);

  return (
    <SettingsContext.Provider value={features}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
