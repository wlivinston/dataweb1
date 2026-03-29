import React from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const NotificationBell: React.FC = () => {
  const { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe } =
    usePushNotifications();

  if (!isSupported) return null;

  const handleClick = async () => {
    if (isLoading) return;

    try {
      if (isSubscribed) {
        await unsubscribe();
        toast.success('Notifications turned off');
      } else {
        await subscribe();
        toast.success('Notifications enabled! You\'ll receive updates about payments, reports, and new posts.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Could not toggle notifications';
      if (msg.includes('denied')) {
        toast.error('Notifications blocked. Enable them in your browser settings.');
      } else {
        toast.error(msg);
      }
    }
  };

  const isDenied = permission === 'denied' && !isSubscribed;

  const Icon = isLoading
    ? Loader2
    : isDenied
      ? BellOff
      : isSubscribed
        ? BellRing
        : Bell;

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || isDenied}
      title={
        isDenied
          ? 'Notifications blocked in browser settings'
          : isSubscribed
            ? 'Turn off notifications'
            : 'Turn on notifications'
      }
      className="relative p-1.5 rounded-full transition-colors hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={isSubscribed ? 'Disable notifications' : 'Enable notifications'}
    >
      <Icon
        className={`h-5 w-5 ${
          isLoading
            ? 'animate-spin text-gray-400'
            : isSubscribed
              ? 'text-blue-600'
              : isDenied
                ? 'text-gray-300'
                : 'text-gray-500'
        }`}
      />
      {/* Unsubscribed dot indicator */}
      {!isSubscribed && !isDenied && !isLoading && (
        <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-500" />
      )}
    </button>
  );
};

export default NotificationBell;
