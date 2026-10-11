// 작품과 설정 저장 (Eng review D6, Design review 7A/8A/10A, Eng re-review R9 저장 형식 v2).
// - wbb.piece.current : 지금 만드는 공
// - wbb.piece.previous: '새 점토' 직전의 공 (구석 동그라미로 되불러오기)
// - wbb.prefs         : 소리 끔, 모드별 안내 손가락 표시 횟수
// 저장이 깨졌거나 형식이 다르면 조용히 버린다 (오류 문구 없음, 새 흰 점토).
import { parsePaintSnapshot, type PaintSnapshot } from './paint';

export const KEY_CURRENT = 'wbb.piece.current';
export const KEY_PREVIOUS = 'wbb.piece.previous';
export const KEY_PREFS = 'wbb.prefs';

export type PieceMode = 'mix' | 'press';

export interface Piece {
  version: 2;
  paint: PaintSnapshot;
  /** ClayDeformer.serializeRadii() 결과 */
  radii: string;
  mode: PieceMode;
  /** 공 회전 쿼터니언 (x, y, z, w) */
  rotation: [number, number, number, number];
  zoom: number;
}

export interface Prefs {
  version: 1;
  muted: boolean;
  hintsShown: { mix: number; press: number };
}

export const DEFAULT_PREFS: Prefs = { version: 1, muted: false, hintsShown: { mix: 0, press: 0 } };

/** localStorage와 같은 모양. 테스트에서는 메모리 저장소를 넣는다 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parsePiece(value: unknown): Piece | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 2) return null;
  const paint = parsePaintSnapshot(v.paint);
  if (!paint) return null;
  if (typeof v.radii !== 'string' || v.radii.length === 0) return null;
  if (v.mode !== 'mix' && v.mode !== 'press') return null;
  if (!Array.isArray(v.rotation) || v.rotation.length !== 4 || !v.rotation.every(isFiniteNumber)) return null;
  if (Math.abs(Math.hypot(...(v.rotation as number[])) - 1) > 1e-3) return null;
  if (!isFiniteNumber(v.zoom) || v.zoom <= 0) return null;
  return { version: 2, paint, radii: v.radii, mode: v.mode, rotation: v.rotation as Piece['rotation'], zoom: v.zoom };
}

export function parsePrefs(value: unknown): Prefs {
  if (typeof value !== 'object' || value === null) return structuredClone(DEFAULT_PREFS);
  const v = value as Record<string, unknown>;
  const hints = (v.hintsShown ?? {}) as Record<string, unknown>;
  const count = (n: unknown) => (isFiniteNumber(n) && n >= 0 ? Math.floor(n) : 0);
  return {
    version: 1,
    muted: v.muted === true,
    hintsShown: { mix: count(hints.mix), press: count(hints.press) },
  };
}

export class PieceStore {
  constructor(private readonly storage: KeyValueStorage | null) {}

  /** 실제 브라우저 저장소. 접근 자체가 막혀 있으면(사생활 보호 등) 저장 없이 동작 */
  static fromWindow(): PieceStore {
    try {
      const storage = window.localStorage;
      const probe = '__wbb_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return new PieceStore(storage);
    } catch {
      return new PieceStore(null);
    }
  }

  private read(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** 저장 실패(용량 초과 등)는 놀이를 막지 않는다. 성공 여부만 돌려준다 */
  private write(key: string, value: unknown): boolean {
    try {
      if (!this.storage) return false;
      if (value === null) this.storage.removeItem(key);
      else this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  loadCurrent(): Piece | null {
    const piece = parsePiece(this.read(KEY_CURRENT));
    if (!piece) this.write(KEY_CURRENT, null);
    return piece;
  }

  saveCurrent(piece: Piece): boolean {
    return this.write(KEY_CURRENT, piece);
  }

  /** 지금 공이 깨진 저장이라 버려야 할 때 (예: 꼭짓점 수가 맞지 않음) */
  discardCurrent(): void {
    this.write(KEY_CURRENT, null);
  }

  loadPrevious(): Piece | null {
    const piece = parsePiece(this.read(KEY_PREVIOUS));
    if (!piece) this.write(KEY_PREVIOUS, null);
    return piece;
  }

  /** '새 점토': 지금 공을 '이전 공'으로 옮기고 지금 칸은 비운다 (10A) */
  moveCurrentToPrevious(current: Piece): void {
    this.write(KEY_PREVIOUS, current);
    this.write(KEY_CURRENT, null);
  }

  /** '이전 공' 동그라미: 지금 공과 이전 공을 맞바꾼다. 이전 공이 없으면 null */
  swapWithPrevious(current: Piece): Piece | null {
    const previous = this.loadPrevious();
    if (!previous) return null;
    this.write(KEY_PREVIOUS, current);
    this.write(KEY_CURRENT, previous);
    return previous;
  }

  loadPrefs(): Prefs {
    return parsePrefs(this.read(KEY_PREFS));
  }

  savePrefs(prefs: Prefs): boolean {
    return this.write(KEY_PREFS, prefs);
  }
}
