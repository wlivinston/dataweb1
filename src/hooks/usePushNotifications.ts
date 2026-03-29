import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { getApiUrl } from '@/lib/publicConfig';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const { session } = useAuth();
  const [isSupported] = useState(
    () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
  );
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => (isSupported ? Notification.permission : 'unsupported')
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const checkedRef = useRef(false);

  // Check current subscription status on mount
  useEffect(() => {
    if (!isSupported || checkedRef.current) return;
    checkedRef.current = true;

    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(sub !== null);
      } catch {
        // Ignore
      }
    });
  }, [isSupported]);

  const getToken = useCallback(() => {
    return session?.access_token || null;
  }, [session]);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);

    try {
      // 1. Fetch VAPID public key from backend
      const keyRes = await fetch(getApiUrl('/api/notifications/vapid-public-key'));
      const keyPayload = await keyRes.json();
      const vapidPublicKey = keyPayload?.data?.key;
      if (!vapidPublicKey) throw new Error('Could not fetch VAPID key');

      // 2. Request notification permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        throw new Error('Notification permission denied');
      }

      // 3. Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready;
      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // 4. Send subscription to backend
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const subJson = pushSub.toJSON();
      const res = await fetch(getApiUrl('/api/notifications/subscribe'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || 'Failed to save subscription');
      }

      setIsSubscribed(true);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, getToken]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const pushSub = await reg.pushManager.getSubscription();

      if (pushSub) {
        const endpoint = pushSub.endpoint;
        await pushSub.unsubscribe();

        // Tell backend
        const token = getToken();
        if (token) {
          await fetch(getApiUrl('/api/notifications/unsubscribe'), {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ endpoint }),
          }).catch(() => {});
        }
      }

      setIsSubscribed(false);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, getToken]);

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
