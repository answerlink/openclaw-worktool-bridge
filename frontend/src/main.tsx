import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Button, ConfigProvider, theme, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

const BOOT_ERROR_STORAGE_KEY = 'worktool_console_last_boot_error';
const CHUNK_RELOAD_STORAGE_KEY = 'worktool_console_chunk_reload';
const VERSION_POLL_INTERVAL_MS = 60_000;

declare const __WORKTOOL_APP_VERSION__: string;

function checkForFrontendUpdate() {
  fetch(`/version.json?poll=${Date.now()}`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((manifest) => {
      if (manifest?.version && manifest.version !== __WORKTOOL_APP_VERSION__) {
        window.location.reload();
      }
    })
    .catch(() => {
      // A transient manifest failure should not interrupt the running app.
    });
}

function isChunkLoadError(error: unknown) {
  const text = String((error as Error | undefined)?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(text);
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      localStorage.setItem(BOOT_ERROR_STORAGE_KEY, JSON.stringify({
        kind: 'react',
        detail: `${error.stack || error.message}\n${info.componentStack || ''}`.slice(0, 4000),
        url: window.location.href,
        time: new Date().toISOString(),
      }));
    } catch {
      // Ignore storage errors.
    }

    if (isChunkLoadError(error)) {
      const reloadKey = `${window.location.pathname}${window.location.search}`;
      try {
        if (sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) !== reloadKey) {
          sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, reloadKey);
          window.location.reload();
        }
      } catch {
        // Fall through to the visible error page.
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-fatal-error" role="alert">
        <div className="app-fatal-error-card">
          <Typography.Title level={4}>页面加载失败</Typography.Title>
          <Typography.Paragraph type="secondary">
            浏览器加载页面资源时发生异常。错误信息已保存在本机，重新加载通常可以恢复。
          </Typography.Paragraph>
          <Typography.Paragraph code ellipsis={{ rows: 3, expandable: true }}>
            {this.state.error.message || String(this.state.error)}
          </Typography.Paragraph>
          <Button type="primary" onClick={() => window.location.reload()}>重新加载</Button>
        </div>
      </div>
    );
  }
}

try {
  localStorage.removeItem('local_robot_list');
} catch {
  // ignore storage errors
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#5f8f98',
          colorBgLayout: '#f6f3ed',
          colorBgContainer: '#fffdf8',
          colorText: '#2f3b40',
          borderRadius: 10
        }
      }}
    >
      <BrowserRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);

window.setInterval(checkForFrontendUpdate, VERSION_POLL_INTERVAL_MS);
