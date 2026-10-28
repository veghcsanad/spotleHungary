import { ArrowDown, ArrowUp, CalendarDays, Check, Guitar, HelpCircle, MapPin, TrendingUp, Users, VenusAndMars, type LucideIcon } from 'lucide-react';
import type { AttributeResult, Direction, GuessResult, Match } from '../../shared/types.ts';

export const GENDER_LABEL = { male: 'Férfi', female: 'Nő', mixed: 'Vegyes' } as const;

export const membersLabel = (n: number | null) => (n == null ? '?' : n === 1 ? 'Szóló' : n === 2 ? 'Duó' : `${n} tag`);

/** Stable pleasant gradient per artist name for the avatar placeholder. */
export function avatarGradient(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 50) % 360} 70% 38%))`;
}

export function Avatar({ name, imageUrl, className }: { name: string; imageUrl: string | null; className: string }) {
  return imageUrl ? (
    <img className={className} src={imageUrl} alt="" />
  ) : (
    <span className={`${className} avatar--placeholder`} style={{ background: avatarGradient(name) }} aria-hidden="true">
      {name[0]}
    </span>
  );
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  match: Match;
  direction?: Direction;
  value: string;
  sub?: string;
  delay: number;
}

function Tile({ icon: Icon, label, match, direction, value, sub, delay }: TileProps) {
  const arrow = direction && match !== 'correct' ? direction : null;
  const Arrow = arrow === 'higher' ? ArrowUp : ArrowDown;
  const hint = arrow
    ? `A keresett érték ${arrow === 'higher' ? 'nagyobb' : 'kisebb'}`
    : match === 'unknown'
      ? 'Nincs elég adat az összehasonlításhoz'
      : undefined;
  return (
    <div className={`tile tile--${match}`} style={{ animationDelay: `${delay}ms` }} title={hint}>
      {arrow && <Arrow className="tile__watermark" aria-hidden="true" />}
      <span className="tile__label">
        <Icon size={13} aria-hidden="true" />
        {label}
      </span>
      <span className="tile__body">
        <span className="tile__text">
          <span className={`tile__value ${value.length > 12 ? 'tile__value--long' : ''}`}>{value}</span>
          {sub && <span className="tile__sub">{sub}</span>}
        </span>
        {arrow && (
          <span className="tile__badge" aria-label={hint}>
            <Arrow size={14} strokeWidth={3} />
          </span>
        )}
        {match === 'correct' && (
          <span className="tile__badge" aria-label="Egyezik">
            <Check size={14} strokeWidth={3} />
          </span>
        )}
        {match === 'unknown' && (
          <span className="tile__badge" aria-label={hint}>
            <HelpCircle size={14} strokeWidth={3} />
          </span>
        )}
      </span>
    </div>
  );
}

const num = (r: AttributeResult<number | null>) => ({ match: r.match, direction: r.direction });

export function GuessCard({ guess, index }: { guess: GuessResult; index: number }) {
  const a = guess.attributes;
  return (
    <article className={`guess ${guess.correct ? 'guess--correct' : ''}`}>
      <header className="guess__header">
        <Avatar name={guess.artist.name} imageUrl={guess.artist.imageUrl} className="guess__avatar" />
        <h3 className="guess__name">{guess.artist.name}</h3>
        <span className="guess__index">{index}. tipp</span>
      </header>
      <div className="guess__tiles">
        <Tile icon={CalendarDays} label="Debütálás" value={String(a.debutYear.value ?? '?')} {...num(a.debutYear)} delay={0} />
        <Tile icon={Users} label="Tagok" value={membersLabel(a.members.value)} {...num(a.members)} delay={70} />
        <Tile icon={TrendingUp} label="Népszerűség" value={`#${a.popularity.value}`} {...num(a.popularity)} delay={140} />
        <Tile
          icon={VenusAndMars}
          label="Nem"
          value={a.gender.value ? GENDER_LABEL[a.gender.value] : '?'}
          match={a.gender.match}
          delay={210}
        />
        <Tile icon={Guitar} label="Műfaj" value={a.genre.value ?? '?'} match={a.genre.match} delay={280} />
        <Tile
          icon={MapPin}
          label="Származás"
          value={a.origin.value.city ?? '?'}
          sub={a.origin.value.region ?? undefined}
          match={a.origin.match}
          delay={350}
        />
      </div>
    </article>
  );
}
