// 七牛云域名或链接只在此处维护。域名示例：https://cdn.example.com
export const CDN_BASE = 'https://cdn.asrtts.cn/static/worktool_console/v1';

// 如单个资源使用独立 URL，可在这里覆盖对应 key。
export const MEDIA_OVERRIDES = {};
export const MEDIA = {
  poster: 'images/video-poster.jpg',
  dashboard: 'images/dashboard.webp',
  robots: 'images/robots.webp',
  providers: 'images/providers.webp',
  scheduled: 'images/scheduled.webp',
  events: 'images/events.webp',
  tags: 'images/tags.webp',
  tasks: 'images/task-center.webp',
  monitor: 'images/monitor.webp',
  video1080: 'videos/worktool-overview-1080p.mp4',
};

export function mediaUrl(key) {
  if (!Object.hasOwn(MEDIA, key)) throw new Error('Unknown media: ' + key);
  if (MEDIA_OVERRIDES[key]) return MEDIA_OVERRIDES[key];
  if (CDN_BASE !== '__QINIU_CDN_BASE__') return CDN_BASE.replace(/\/$/, '') + '/' + MEDIA[key];
  // 本地预览读取被 Git 忽略的素材目录。线上部署前须配置真实 CDN 地址。
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return '/media/worktool/v1/' + MEDIA[key];
  return null;
}
