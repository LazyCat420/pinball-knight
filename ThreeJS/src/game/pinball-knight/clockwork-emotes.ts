/** Permanent progression rewards; equipped launches grant their authored speed and coasting bonuses. */
import { loadUnlockedDepth } from './unlocked-depths';
export const CLOCKWORK_EMOTES = [
  { id: 'bowling', icon: '🎳', label: 'Bowling', floor: 1 },
  { id: 'football', icon: '🏈', label: 'Football', floor: 2 },
  { id: 'baseball', icon: '⚾', label: 'Baseball', floor: 3 },
] as const;
export type ClockworkEmote = typeof CLOCKWORK_EMOTES[number]['id'];
const KEY = 'pinball-knight-clockwork-emote';
let session: ClockworkEmote | undefined;
export function emoteUnlocked(id: ClockworkEmote): boolean {
  const def = CLOCKWORK_EMOTES.find(e => e.id === id);
  return !!def && loadUnlockedDepth() >= def.floor;
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
