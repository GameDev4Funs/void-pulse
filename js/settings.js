const defaults = { music: 0.55, sfx: 0.8, autoAim: true, reducedMotion: false };
export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('vp_settings') || '{}') || {}; } catch { /* old/corrupt preferences */ }
  const result = { ...defaults };
  for (const key of ['music', 'sfx']) if (Number.isFinite(saved[key])) result[key] = Math.min(1, Math.max(0, saved[key]));
  for (const key of ['autoAim', 'reducedMotion']) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  return result;
}
export function saveSettings(settings) { localStorage.setItem('vp_settings', JSON.stringify(settings)); }
