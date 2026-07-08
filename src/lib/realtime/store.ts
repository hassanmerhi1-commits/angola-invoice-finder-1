// Realtime Store - Simplified for new async storage
// Now uses Electron WebSocket sync via preload API

import { useState, useEffect } from 'react';
import { realtimeSocket } from './socket';

export function useRealtimeStatus() {
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<'realtime' | 'local'>('local');

  useEffect(() => {
    const isElectron = !!window.electronAPI?.isElectron;
    if (!isElectron) {
      setMode('local');
      setIsConnected(false);
      return;
    }
    setMode('realtime');
    realtimeSocket.connect();
    const id = window.setInterval(() => {
      setIsConnected(realtimeSocket.isConnected());
    }, 2000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return { isConnected, mode };
}
