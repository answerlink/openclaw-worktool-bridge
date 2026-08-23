const ANALYTICS_ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED === 'true';
const ANALYTICS_URL = String(import.meta.env.VITE_ANALYTICS_URL || 'https://analytics.ymdyes.cn').replace(/\/$/, '');
const WEBSITE_ID = String(import.meta.env.VITE_ANALYTICS_WEBSITE_ID || '');

let ready = false;
let scriptPromise: Promise<void> | null = null;

function loadTracker(): Promise<void> {
  if (!ANALYTICS_ENABLED || !WEBSITE_ID || typeof document === 'undefined') return Promise.resolve();
  if (ready) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-website-id]');
    if (existing) {
      ready = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.defer = true;
    script.src = `${ANALYTICS_URL}/script.js`;
    script.dataset.websiteId = WEBSITE_ID;
    script.onload = () => {
      ready = true;
      resolve();
    };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function track(name: string, data?: Record<string, unknown>) {
  void loadTracker().then(() => {
    const umami = (window as any).umami;
    if (typeof umami?.track === 'function') {
      umami.track(name, data);
    }
  });
}

export function trackPage(path: string) {
  track('page_view', { path });
}

export function isAnalyticsEnabled() {
  return ANALYTICS_ENABLED && Boolean(WEBSITE_ID);
}
