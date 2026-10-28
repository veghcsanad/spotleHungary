import {
  Disc3,
  Handshake,
  Lightbulb,
  Music,
  Quote,
  Sparkles,
  Trophy,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

const HINT_ICONS: Record<string, LucideIcon> = {
  song: Music,
  album: Disc3,
  collab: Handshake,
  initials: Type,
  member: UserRound,
  lyric: Quote,
  award: Trophy,
  trivia: Lightbulb,
};

export function HintIcon({ type, size = 18 }: { type: string; size?: number }) {
  const Icon = HINT_ICONS[type] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}
