import { useState } from 'react';
import { MAX_GUESSES } from '../../shared/game.ts';
import type { GameState } from '../storage.ts';
import { Modal } from './Modal.tsx';
import { Avatar } from './GuessCard.tsx';
import { HintIcon } from './icons.tsx';

interface Props {
  game: GameState;
  shareText: string;
  isDaily: boolean;
  onPlayPractice: () => void;
  onClose: () => void;
}

export function ResultModal({ game, shareText, isDaily, onPlayPractice, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const won = game.status === 'won';
  const answer = game.answer;

  const share = async () => {
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // user cancelled share sheet
    }
  };

  return (
    <Modal title={won ? 'Gratulálunk! 🎉' : 'Majd legközelebb!'} onClose={onClose}>
      {answer && (
        <div className="answer">
          <Avatar name={answer.name} imageUrl={answer.imageUrl} className="answer__img" />
          <div>
            <p className="muted">A keresett előadó:</p>
            <p className="answer__name">{answer.name}</p>
          </div>
        </div>
      )}
      {answer && answer.hints.length > 0 && (
        <ul className="answer__hints">
          {answer.hints.map((h) => (
            <li key={h.slot} className={game.chosenHint?.slot === h.slot ? 'is-picked' : ''}>
              <HintIcon type={h.type} size={15} />
              <span className="muted">{h.label}:</span> {h.value}
            </li>
          ))}
        </ul>
      )}
      <p className="result-line">
        {won
          ? `${game.guesses.length} tippből sikerült!`
          : game.guesses.length < MAX_GUESSES
            ? 'Feladtad – legközelebb sikerül!'
            : 'Elfogytak a tippek.'}
      </p>
      <pre className="share-preview">{shareText}</pre>
      <div className="actions">
        <button className="btn btn--primary" onClick={share}>
          {copied ? 'Vágólapra másolva ✓' : 'Megosztás'}
        </button>
        <button className="btn" onClick={onPlayPractice}>
          {isDaily ? 'Gyakorló játék' : 'Új gyakorló játék'}
        </button>
      </div>
    </Modal>
  );
}
