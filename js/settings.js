const defaults = { music: 0.55, sfx: 0.8, autoAim: true, reducedMotion: false, quality: 'high' };
export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('vp_settings') || '{}') || {}; } catch { /* old/corrupt preferences */ }
  const result = { ...defaults };
  for (const key of ['music', 'sfx']) if (Number.isFinite(saved[key])) result[key] = Math.min(1, Math.max(0, saved[key]));
  for (const key of ['autoAim', 'reducedMotion']) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  if (['high', 'low'].includes(saved.quality)) result.quality = saved.quality;
  return result;
}
export function saveSettings(settings) {
  try { localStorage.setItem('vp_settings', JSON.stringify(settings)); } catch { /* private mode / full storage: keep this session's preferences */ }
}
