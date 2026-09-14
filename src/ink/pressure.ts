import { MIN_PRESSURE_WIDTH_RATIO, PRESSURE_SMOOTHING } from '../config';
import { clamp } from './geometry';
import type { StrokePoint } from '../model/types';

const STORAGE_KEY = 'notes.pressure-support';

/**
 * Nicht jedes Geraet liefert echten Stiftdruck: manche melden konstant 0,
 * manche konstant 0.5, und ein Apple Pencil (USB-C) bzw. eine Maus hat gar
 * keinen Drucksensor. Ein Strich mit konstantem "Druck" saehe sonst duenner
 * aus als gewollt.
 *
 * Die Probe sammelt deshalb ueber die Sitzung hinweg Stichproben und
 * entscheidet einmal, ob das Geraet Druck kann.
 *
 * Konvention fuers Datenmodell: kann das Geraet keinen Druck, wird
 * `pressure: 1` gespeichert – also "volle eingestellte Breite". Damit bleibt
 * der Renderer eine reine Funktion der gespeicherten Punkte, und ein
 * nachgezeichneter Strich sieht exakt aus wie der live gezeichnete.
 */
export class PressureProbe {
  private verdict: 'unknown' | 'supported' | 'unsupported' = 'unknown';
  private seen = new Set<number>();
  private samplesInStroke = 0;

  constructor() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'yes') this.verdict = 'supported';
      else if (stored === 'no') this.verdict = 'unsupported';
    } catch {
      // Privater Modus o.ae. – dann eben jede Sitzung neu lernen.
    }
  }

  get supportsPressure(): boolean {
    return this.verdict === 'supported';
  }

  /** Nur echte Stift-Samples fuettern – Maus und Finger wuerden das Urteil verfaelschen. */
  observe(rawPressure: number): void {
    if (this.verdict === 'supported') return;

    this.samplesInStroke++;
    // Auf 2 Nachkommastellen runden, damit Sensorrauschen nicht als
    // "echte Varianz" durchgeht.
    this.seen.add(Math.round(rawPressure * 100) / 100);

    if (this.seen.size >= 3) this.setVerdict('supported');
  }

  /** Am Ende eines Strichs aufrufen. */
  endStroke(): void {
    if (this.verdict === 'unknown' && this.samplesInStroke >= 15) {
      this.setVerdict('unsupported');
    }
    this.seen.clear();
    this.samplesInStroke = 0;
  }

  /**
   * Rohwert -> Wert, der gespeichert wird.
   * Solange das Urteil noch nicht feststeht, wird konservativ auf konstante
   * Breite gegangen; der erste Strich einer frischen Installation ist also
   * gleichmaessig dick.
   */
  normalize(rawPressure: number): number {
    if (this.verdict !== 'supported') return 1;
    return clamp(rawPressure, 0, 1);
  }

  private setVerdict(next: 'supported' | 'unsupported'): void {
    this.verdict = next;
    try {
      localStorage.setItem(STORAGE_KEY, next === 'supported' ? 'yes' : 'no');
    } catch {
      // egal
    }
  }
}

/**
 * Exponentiell gleitender Mittelwert ueber den Druck. Rohe Sensorwerte
 * zappeln, was man als Dellen im Strich sieht.
 */
export function smoothPressure(previous: number | null, next: number): number {
  if (previous === null) return next;
  return previous * PRESSURE_SMOOTHING + next * (1 - PRESSURE_SMOOTHING);
}

/** Gespeicherter Druck -> tatsaechliche Strichbreite in Page-Space-Pixeln. */
export function widthAt(point: StrokePoint, baseWidth: number): number {
  const ratio = MIN_PRESSURE_WIDTH_RATIO + (1 - MIN_PRESSURE_WIDTH_RATIO) * point.pressure;
  return baseWidth * ratio;
}
