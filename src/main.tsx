
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);

// ---------------------------------------------------------------------------
// PWA: Service worker registration with update notification
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates every 30 minutes
        setInterval(() => reg.update(), 30 * 60 * 1000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Show a non-intrusive update banner
              showUpdateBanner(() => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              });
            }
          });
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // Reload the page when the new SW takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

function showUpdateBanner(onUpdate: () => void) {
  // Don't duplicate
  if (document.getElementById('pwa-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'polite');
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
    background: '#1e293b',
    color: '#f1f5f9',
    padding: '.75rem 1.25rem',
    borderRadius: '.5rem',
    boxShadow: '0 4px 20px rgba(0,0,0,.25)',
    fontSize: '.875rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 'calc(100vw - 2rem)',
  });

  const text = document.createElement('span');
  text.textContent = 'A new version is available.';
  banner.appendChild(text);

  const btn = document.createElement('button');
  btn.textContent = 'Update';
  Object.assign(btn.style, {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '.375rem',
    padding: '.375rem .875rem',
    fontSize: '.8125rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  btn.addEventListener('click', onUpdate);
  banner.appendChild(btn);

  const dismiss = document.createElement('button');
  dismiss.textContent = '\u00d7';
  dismiss.setAttribute('aria-label', 'Dismiss');
  Object.assign(dismiss.style, {
    background: 'transparent',
    color: '#94a3b8',
    border: 'none',
    fontSize: '1.25rem',
    cursor: 'pointer',
    padding: '0 .25rem',
    lineHeight: '1',
  });
  dismiss.addEventListener('click', () => banner.remove());
  banner.appendChild(dismiss);

  document.body.appendChild(banner);
}
