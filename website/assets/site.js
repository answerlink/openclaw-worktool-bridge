import { mediaUrl } from './media.js';

document.querySelectorAll('[data-image]').forEach(image => {
  const url = mediaUrl(image.dataset.image);
  if (url) image.src = url;
  else image.closest('.media-surface')?.classList.add('asset-unavailable');
  image.addEventListener('error', () => image.closest('.media-surface')?.classList.add('asset-unavailable'));
});
document.querySelectorAll('[data-media-link]').forEach(link => {
  const url = mediaUrl(link.dataset.mediaLink);
  if (url) link.href = url;
  else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
});
const menu = document.querySelector('.menu-toggle');
menu?.addEventListener('click', () => {
  const expanded = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', String(!expanded));
  document.querySelector('#navigation').classList.toggle('is-open', !expanded);
});
document.querySelectorAll('#navigation a').forEach(link => link.addEventListener('click', () => {
  menu?.setAttribute('aria-expanded', 'false');
  document.querySelector('#navigation').classList.remove('is-open');
}));
const video = document.querySelector('#product-video');
if (video) {
  const url = mediaUrl('video1080'), poster = mediaUrl('poster');
  if (poster) video.poster = poster;
  if (url) video.src = url;
  else document.querySelector('.video-status').hidden = false;
  video.addEventListener('error', () => { document.querySelector('.video-status').hidden = false; });
  document.querySelectorAll('[data-seek]').forEach(button => button.addEventListener('click', () => {
    if (!video.src || video.error) return;
    video.currentTime = Number(button.dataset.seek);
    video.play().catch(() => {});
  }));
  video.addEventListener('timeupdate', () => {
    const chapters = [...document.querySelectorAll('[data-seek]')];
    const current = chapters.findLast(button => Number(button.dataset.seek) <= video.currentTime);
    chapters.forEach(button => button.setAttribute('aria-current', button === current ? 'true' : 'false'));
  });
}
