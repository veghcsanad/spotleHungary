import { CLOSE_THRESHOLDS, HINT_UNLOCK_AFTER, MAX_GUESSES } from '../../shared/game.ts';
import { Modal } from './Modal.tsx';

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Hogyan játssz?" onClose={onClose}>
      <p>
        Találd ki a nap magyar előadóját <strong>{MAX_GUESSES} tippből</strong>! Minden tipp után megmutatjuk, mennyire
        vagy közel a megoldáshoz.
      </p>
      <ul className="legend">
        <li>
          <span className="swatch tile--correct" /> Egyezik a keresett előadóval
        </li>
        <li>
          <span className="swatch tile--close" /> Közel jársz
        </li>
        <li>
          <span className="swatch tile--wrong" /> Nem egyezik
        </li>
        <li>
          <span className="swatch tile--unknown" /> Nincs adat (az egyik előadónál ismeretlen)
        </li>
      </ul>
      <h3>Kategóriák</h3>
      <dl className="help-list">
        <dt>Debütálás</dt>
        <dd>Az első album éve. Sárga: legfeljebb {CLOSE_THRESHOLDS.debutYear} év eltérés.</dd>
        <dt>Tagok</dt>
        <dd>Szóló előadó vagy együttes tagjainak száma. Sárga: {CLOSE_THRESHOLDS.members} tag eltérés.</dd>
        <dt>Népszerűség</dt>
        <dd>
          Helyezés a havi hallgatók száma alapján (#1 a legnépszerűbb). Sárga: legfeljebb {CLOSE_THRESHOLDS.popularity}{' '}
          hely eltérés.
        </dd>
        <dt>Nem</dt>
        <dd>Férfi, nő vagy vegyes együttes.</dd>
        <dt>Műfaj</dt>
        <dd>Sárga: rokon műfaj (pl. rock és alternatív rock).</dd>
        <dt>Származás</dt>
        <dd>Szülőváros / alapítás helye. Sárga: ugyanabból a régióból.</dd>
      </dl>
      <p>
        A <strong>↑ / ↓</strong> nyíl azt mutatja, hogy a keresett előadó értéke nagyobb vagy kisebb a tippedénél.
      </p>
      <p>
        <strong>Segítség:</strong> minden előadóhoz három segítség tartozik (pl. ismert dal, album, közös munka,
        kezdőbetűk). Előre látod a típusukat, de {HINT_UNLOCK_AFTER} tipp után csak <strong>egyet</strong> fedhetsz fel
        – válassz okosan!
      </p>
      <p className="muted">Minden nap éjfélkor (magyar idő szerint) új előadó vár. Gyakorló módban korlátlanul játszhatsz.</p>
    </Modal>
  );
}
