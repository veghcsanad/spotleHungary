import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, ChartColumn, RotateCcw, Flag } from 'lucide-react';
import type { ArtistOption, PuzzleInfo } from '../shared/types.ts';
import { api } from './api.ts';
import {
  hasSeenHelp,
  loadGame,
  loadPracticeId,
  loadStats,
  markHelpSeen,
  recordDailyResult,
  saveGame,
  savePracticeId,
  type GameState,
  type Mode,
  type Stats,
} from './storage.ts';
import { buildShareText } from './share.ts';
import { GuessCard } from './components/GuessCard.tsx';
import { SearchBox } from './components/SearchBox.tsx';
import { HelpModal } from './components/HelpModal.tsx';
import { StatsModal } from './components/StatsModal.tsx';
import { HintPanel } from './components/HintPanel.tsx';
import { Avatar } from './components/GuessCard.tsx';
import { ResultModal } from './components/ResultModal.tsx';

type ModalKind = 'help' | 'stats' | 'result' | null;

const REVEAL_DELAY_MS = 900;

export default function App() {
  const [mode, setMode] = useState<Mode>('daily');
  const [artists, setArtists] = useState<ArtistOption[]>([]);
  const [puzzle, setPuzzle] = useState<PuzzleInfo | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [stats, setStats] = useState<Stats>(loadStats);
  const [modal, setModal] = useState<ModalKind>(hasSeenHelp() ? null : 'help');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateGame = useCallback((next: GameState) => {
    saveGame(next);
    setGame(next);
  }, []);

  const loadSeq = useRef(0);
  const loadPuzzle = useCallback(async (m: Mode, forceNewPractice = false) => {
    const seq = ++loadSeq.current;
    setError(null);
    setPuzzle(null);
    setGame(null);
    try {
      let info: PuzzleInfo;
      if (m === 'daily') {
        info = await api.daily();
      } else {
        const saved = forceNewPractice ? null : loadPracticeId();
        const resumable = saved && loadGame(saved).status === 'playing' ? saved : null;
        info = resumable ? await api.puzzle(resumable).catch(() => api.newPractice()) : await api.newPractice();
        savePracticeId(info.puzzleId);
      }
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      let g = loadGame(info.puzzleId);
      if (g.hintOptions.length === 0) {
        const hintOptions = await api.hintOptions(info.puzzleId).catch(() => []);
        if (seq !== loadSeq.current) return;
        g = { ...g, hintOptions };
        saveGame(g);
      }
      // Finished games saved by older versions may lack the answer or its hints.
      if (g.status !== 'playing' && !Array.isArray(g.answer?.hints)) {
        const answer = await api.answer(info.puzzleId).catch(() => null);
        if (seq !== loadSeq.current) return;
        g = { ...g, answer };
        saveGame(g);
      }
      setPuzzle(info);
      setGame(g);
      if (g.status !== 'playing') setModal((cur) => cur ?? 'result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
    }
  }, []);

  useEffect(() => {
    api.artists().then(setArtists, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    void loadPuzzle(mode);
  }, [mode, loadPuzzle]);

  const finish = useCallback(
    async (g: GameState, won: boolean) => {
      if (!puzzle) return;
      const answer = await api.answer(puzzle.puzzleId).catch(() => null);
      const done: GameState = { ...g, status: won ? 'won' : 'lost', answer };
      updateGame(done);
      if (puzzle.puzzleNumber !== null) setStats(recordDailyResult(puzzle.puzzleNumber, won, done.guesses.length));
      setTimeout(() => setModal('result'), won ? REVEAL_DELAY_MS : 0);
    },
    [puzzle, updateGame],
  );

  const submitGuess = async (artist: ArtistOption) => {
    if (!puzzle || !game || busy || game.status !== 'playing') return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.guess(puzzle.puzzleId, artist.id);
      const next: GameState = { ...game, guesses: [...game.guesses, result] };
      updateGame(next);
      if (result.correct) await finish(next, true);
      else if (next.guesses.length >= puzzle.maxGuesses) await finish(next, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
    } finally {
      setBusy(false);
    }
  };

  const chooseHint = async (slot: number) => {
    if (!puzzle || !game || busy || game.chosenHint || game.status !== 'playing') return;
    setBusy(true);
    setError(null);
    try {
      const chosenHint = await api.revealHint(puzzle.puzzleId, slot, game.guesses.length);
      updateGame({ ...game, chosenHint });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
    } finally {
      setBusy(false);
    }
  };

  const giveUp = () => {
    if (game && game.status === 'playing' && confirm('Biztosan feladod?')) void finish(game, false);
  };

  const guessedIds = useMemo(() => new Set(game?.guesses.map((g) => g.artist.id)), [game]);
  const shareText = useMemo(
    () =>
      game && puzzle
        ? buildShareText({
            puzzleNumber: puzzle.puzzleNumber,
            guesses: game.guesses,
            won: game.status === 'won',
            url: window.location.origin,
          })
        : '',
    [game, puzzle],
  );

  const closeModal = () => {
    if (modal === 'help') markHelpSeen();
    setModal(null);
  };

  const playing = game?.status === 'playing';

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setModal('help')} aria-label="Súgó">
          <CircleHelp size={20} />
        </button>
        <h1 className="logo">
          SP<span className="logo__o" aria-hidden="true" />
          <span className="sr-only">O</span>TLE <span className="logo__hu">HU</span>
        </h1>
        <button className="icon-btn" onClick={() => setModal('stats')} aria-label="Statisztika">
          <ChartColumn size={20} />
        </button>
      </header>

      <nav className="mode-toggle" aria-label="Játékmód">
        <button className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>
          Napi
        </button>
        <button className={mode === 'practice' ? 'active' : ''} onClick={() => setMode('practice')}>
          Gyakorló
        </button>
      </nav>

      <main className="main">
        <p className="subtitle">
          {puzzle?.puzzleNumber ? `#${puzzle.puzzleNumber} · ` : ''}
          {puzzle?.maxGuesses ?? 10} tipp · {puzzle?.artistCount ?? '…'} előadó
        </p>

        {error && <p className="error">{error}</p>}

        {game && puzzle && (
          <>
            {playing ? (
              <div className="controls">
                <SearchBox
                  artists={artists}
                  excludeIds={guessedIds}
                  disabled={busy}
                  placeholder={`${game.guesses.length + 1}. tipp – írd be az előadó nevét`}
                  onSelect={submitGuess}
                />
                <div className="controls__row">
                  <div
                    className="pips"
                    role="img"
                    aria-label={`${game.guesses.length} / ${puzzle.maxGuesses} tipp felhasználva`}
                  >
                    {Array.from({ length: puzzle.maxGuesses }, (_, i) => (
                      <span key={i} className={`pip ${i < game.guesses.length ? 'pip--used' : ''}`} />
                    ))}
                  </div>
                  {game.guesses.length > 0 && (
                    <button className="link-btn" onClick={giveUp}>
                      <Flag size={14} /> Feladom
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={`finished finished--${game.status}`}>
                {game.answer && (
                  <Avatar name={game.answer.name} imageUrl={game.answer.imageUrl} className="finished__avatar" />
                )}
                <div className="finished__text">
                  <span className="finished__kicker">{game.status === 'won' ? 'Kitaláltad!' : 'A megoldás'}</span>
                  <strong className="finished__name">{game.answer?.name ?? '?'}</strong>
                </div>
                <div className="actions">
                  <button className="btn btn--primary" onClick={() => setModal('result')}>
                    Eredmény
                  </button>
                  {mode === 'practice' && (
                    <button className="btn" onClick={() => void loadPuzzle('practice', true)}>
                      <RotateCcw size={16} /> Új játék
                    </button>
                  )}
                </div>
              </div>
            )}

            <HintPanel
              options={game.hintOptions}
              chosen={game.chosenHint}
              revealedAll={playing ? null : (game.answer?.hints ?? null)}
              guesses={game.guesses.length}
              busy={busy}
              onChoose={(slot) => void chooseHint(slot)}
            />

            <section className="guesses" aria-live="polite">
              {[...game.guesses].reverse().map((g, i) => (
                <GuessCard key={g.artist.id} guess={g} index={game.guesses.length - i} />
              ))}
            </section>
          </>
        )}

        {!game && !error && <p className="muted center">Betöltés…</p>}
      </main>

      {modal === 'help' && <HelpModal onClose={closeModal} />}
      {modal === 'stats' && (
        <StatsModal
          stats={stats}
          highlight={mode === 'daily' && game?.status === 'won' ? game.guesses.length : undefined}
          onClose={closeModal}
        />
      )}
      {modal === 'result' && game && game.status !== 'playing' && (
        <ResultModal
          game={game}
          shareText={shareText}
          isDaily={mode === 'daily'}
          onClose={closeModal}
          onPlayPractice={() => {
            setModal(null);
            if (mode === 'practice') void loadPuzzle('practice', true);
            else setMode('practice');
          }}
        />
      )}
    </div>
  );
}
