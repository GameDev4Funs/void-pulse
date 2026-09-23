// Records are comparable only within the same planet, mode, and solo/team size.
const STORAGE_KEY = 'vp_records_v2';
export function recordKey(planet, players = 1, multiplayer = false, endless = false) {
  return `${planet}:${multiplayer ? `squad-${players}` : 'solo'}:${endless ? 'endless' : 'mission'}`;
}
export function readRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function bestRecord(key) {
  const score = readRecords()[key]?.score;
  return Number.isFinite(score) ? Math.max(0, score) : 0;
}
export function saveRecord(key, summary) {
  const records = readRecords();
  const score = Math.max(0, Math.floor(summary.score));
  const isBest = score > (Number(records[key]?.score) || 0);
  if (isBest) {
    records[key] = { ...summary, score };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* play still works without storage */ }
  }
  return { isBest, best: Math.max(score, Number(records[key]?.score) || 0) };
}
