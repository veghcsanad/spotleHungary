import type { Stats } from '../storage.ts';
import { Modal } from './Modal.tsx';

export function StatsModal({ stats, highlight, onClose }: { stats: Stats; highlight?: number; onClose: () => void }) {
  const max = Math.max(1, ...stats.distribution);
  const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  return (
    <Modal title="Statisztika" onClose={onClose}>
      <div className="stats">
        <Stat value={stats.played} label="Játék" />
        <Stat value={`${winPct}%`} label="Nyerés" />
        <Stat value={stats.currentStreak} label="Sorozat" />
        <Stat value={stats.maxStreak} label="Leghosszabb" />
      </div>
      <h3>Tippek eloszlása</h3>
      <div className="dist">
        {stats.distribution.map((count, i) => (
          <div className="dist__row" key={i}>
            <span className="dist__label">{i + 1}</span>
            <div
              className={`dist__bar ${highlight === i + 1 ? 'dist__bar--hl' : ''}`}
              style={{ width: `${Math.max(8, (count / max) * 100)}%` }}
            >
              {count}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">A statisztika csak a napi játékokat számolja.</p>
    </Modal>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
