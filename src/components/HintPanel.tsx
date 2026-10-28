import { Lock, LockOpen } from 'lucide-react';
import type { HintOption, RevealedHint } from '../../shared/types.ts';
import { HINT_UNLOCK_AFTER } from '../../shared/game.ts';
import { HintIcon } from './icons.tsx';

interface Props {
  options: HintOption[];
  chosen: RevealedHint | null;
  /** All hint values, available once the game is over. */
  revealedAll: RevealedHint[] | null;
  guesses: number;
  busy: boolean;
  onChoose: (slot: number) => void;
}

export function HintPanel({ options, chosen, revealedAll, guesses, busy, onChoose }: Props) {
  const unlocked = guesses >= HINT_UNLOCK_AFTER;
  const remaining = Math.max(0, HINT_UNLOCK_AFTER - guesses);
  const finished = revealedAll !== null;

  let status: string;
  if (finished) status = 'Az előadó segítségei';
  else if (chosen) status = 'Felhasználtad a segítséget';
  else if (unlocked) status = 'Válassz egyet a segítségek közül!';
  else status = `Még ${remaining} tipp, és választhatsz egy segítséget`;

  if (options.length === 0 && !finished) return null;

  const items = finished ? revealedAll : options;

  return (
    <section className={`hints ${unlocked && !chosen && !finished ? 'hints--ready' : ''}`} aria-label="Segítség">
      <header className="hints__header">
        <span className="hints__title">
          {unlocked || finished ? <LockOpen size={16} /> : <Lock size={16} />}
          Segítség
        </span>
        <span className="hints__status">{status}</span>
      </header>
      {!unlocked && !finished && (
        <div className="hints__progress" aria-hidden="true">
          <span style={{ width: `${(guesses / HINT_UNLOCK_AFTER) * 100}%` }} />
        </div>
      )}
      <div className="hints__grid">
        {items.map((opt) => {
          const value = finished
            ? (opt as RevealedHint).value
            : chosen?.slot === opt.slot
              ? chosen.value
              : null;
          const selectable = unlocked && !chosen && !finished;
          const dimmed = !finished && chosen !== null && chosen.slot !== opt.slot;
          return (
            <button
              key={opt.slot}
              type="button"
              className={`hint ${value ? 'hint--revealed' : ''} ${selectable ? 'hint--selectable' : ''} ${dimmed ? 'hint--dimmed' : ''} ${finished && chosen?.slot === opt.slot ? 'hint--picked' : ''}`}
              disabled={!selectable || busy}
              onClick={() => onChoose(opt.slot)}
            >
              <span className="hint__icon">
                <HintIcon type={opt.type} />
              </span>
              <span className="hint__text">
                <span className="hint__label">{opt.label}</span>
                <span className="hint__value">{value ?? (selectable ? 'Felfedés' : '•••')}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
