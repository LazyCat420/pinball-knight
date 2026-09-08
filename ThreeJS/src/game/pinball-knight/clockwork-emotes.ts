/** All three launches are available immediately, with their authored speed and coasting bonuses. */
export const CLOCKWORK_EMOTES = [
  { id: 'bowling', icon: '🎳', label: 'Bowling' },
  { id: 'football', icon: '🏈', label: 'Football' },
  { id: 'baseball', icon: '⚾', label: 'Baseball' },
] as const;
export type ClockworkEmote = typeof CLOCKWORK_EMOTES[number]['id'];
const KEY = 'pinball-knight-clockwork-emote';
let session: ClockworkEmote | undefined;
export function emoteUnlocked(id: ClockworkEmote): boolean {
  const def = CLOCKWORK_EMOTES.find(e => e.id === id);
  return !!def;
}
export function activeClockworkEmote(): ClockworkEmote {
  let saved: unknown = session;
  if (saved === undefined) { try { saved = localStorage.getItem(KEY); } catch { /* Session only. */ } }
  if (saved === 'basketball') saved = 'football'; // Migrate the replaced floor-two reward.
  const def = CLOCKWORK_EMOTES.find(e => e.id === saved);
  return def && emoteUnlocked(def.id) ? def.id : 'bowling';
}
export function equipClockworkEmote(id: ClockworkEmote): boolean {
  if (!emoteUnlocked(id)) return false;
  session = id;
  try { localStorage.setItem(KEY, id); } catch { /* Session only. */ }
  return true;
}
