import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.BUILD_VERSION || `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

const versionPlugin = {
  name: 'worktool-version-manifest',
  transformIndexHtml(html: string) {
    return html.replaceAll('__WORKTOOL_APP_VERSION__', appVersion);
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version: appVersion }, null, 2),
    });
  },
};

export default defineConfig({
  plugins: [react(), versionPlugin],
  define: {
    __WORKTOOL_APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
});
