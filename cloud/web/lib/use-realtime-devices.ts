'use client';

import { useEffect, useState, useRef } from 'react';

interface Device {
  id: string;
  deviceId: string;
  siteName: string;
  location?: string;
  status: string;
  lastSeenAt?: string;
  latestTelemetry?: {
    oilPercent: number;
    oilLiters: number;
    flowLpm: number;
    pumpState: boolean;
    ts: number;
  };
}

export function useRealTimeDevices(enabled: boolean = true) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Create EventSource connection
    const eventSource = new EventSource('/api/stream');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setDevices(data);
      } catch (e) {
        console.error('Failed to parse SSE data:', e);
      }
    };

    eventSource.onerror = (e) => {
      console.error('SSE connection error:', e);
      setIsConnected(false);
      setError('Connection lost. Reconnecting...');
      eventSource.close();
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
      }, 5000);
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [enabled]);

  return { devices, isConnected, error };
}
