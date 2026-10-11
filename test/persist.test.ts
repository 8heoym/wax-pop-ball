import { beforeAll, describe, expect, it } from 'vitest';
import { ClayDeformer, createClayGeometry } from '../src/clay';
import { PaintState } from '../src/paint';
import {
  DEFAULT_PREFS,
  KEY_CURRENT,
  KEY_PREFS,
  KEY_PREVIOUS,
  PieceStore,
  parsePiece,
  type KeyValueStorage,
  type Piece,
} from '../src/persist';

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

class FullStorage extends MemoryStorage {
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

let positions: Float32Array;
beforeAll(() => {
  positions = createClayGeometry().getAttribute('position').array as Float32Array;
});

function makePiece(tube: 'blue' | 'red', mode: Piece['mode'] = 'press'): Piece {
  const paint = new PaintState();
  paint.startSqueeze(tube, [0, 1, 0]);
  paint.updateSqueeze(1.5);
  paint.endSqueeze();
  paint.stir(3);
  const clay = new ClayDeformer(positions);
  clay.tap([0, 1, 0]);
  return { version: 2, paint: paint.toSnapshot(), radii: clay.serializeRadii(), mode, rotation: [0, 0, 0, 1], zoom: 1.2 };
}

/** 실제 저장처럼 JSON을 거친 값 */
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('작품 저장/복원 (D6, R9)', () => {
  it('지금 공을 저장하고 그대로 불러온다', () => {
    const store = new PieceStore(new MemoryStorage());
    const piece = makePiece('blue');
    expect(store.saveCurrent(piece)).toBe(true);
    expect(store.loadCurrent()).toEqual(roundTrip(piece));
  });

  it('불러온 저장으로 물감과 점토 모양이 복원된다', () => {
    const store = new PieceStore(new MemoryStorage());
    const piece = makePiece('blue');
    store.saveCurrent(piece);
    const loaded = store.loadCurrent()!;
    const paint = new PaintState(loaded.paint);
    expect(paint.finalRgb()).toEqual(new PaintState(piece.paint).finalRgb());
    const clay = new ClayDeformer(positions);
    expect(clay.restoreRadii(loaded.radii)).toBe(true);
    expect(clay.isDented()).toBe(true);
  });

  it('저장이 없으면 null', () => {
    expect(new PieceStore(new MemoryStorage()).loadCurrent()).toBeNull();
  });

  it.each<[string, (p: any) => unknown]>([
    ['JSON 아님', () => '{not json'],
    ['v1 형식', (p) => ({ ...p, version: 1 })],
    ['물감 손상', (p) => ({ ...p, paint: { ...p.paint, blobs: [] } })],
    ['반지름 없음', (p) => ({ ...p, radii: '' })],
    ['모드 이상', (p) => ({ ...p, mode: 'paint' })],
    ['회전이 단위 쿼터니언 아님', (p) => ({ ...p, rotation: [0, 0, 0, 2] })],
    ['확대 0', (p) => ({ ...p, zoom: 0 })],
  ])('깨진 저장은 버리고 null: %s', (_name, corrupt) => {
    const storage = new MemoryStorage();
    const value = corrupt(roundTrip(makePiece('blue')));
    storage.setItem(KEY_CURRENT, typeof value === 'string' ? value : JSON.stringify(value));
    const store = new PieceStore(storage);
    expect(store.loadCurrent()).toBeNull();
    expect(storage.getItem(KEY_CURRENT)).toBeNull();
  });

  it('parsePiece는 정상 저장을 통과시킨다', () => {
    expect(parsePiece(roundTrip(makePiece('red', 'mix')))).not.toBeNull();
  });
});

describe('이전 공 (10A)', () => {
  it('새 점토: 지금 공이 이전 공으로 가고 지금 칸은 빈다', () => {
    const storage = new MemoryStorage();
    const store = new PieceStore(storage);
    const blue = makePiece('blue');
    store.saveCurrent(blue);
    store.moveCurrentToPrevious(blue);
    expect(store.loadCurrent()).toBeNull();
    expect(store.loadPrevious()).toEqual(roundTrip(blue));
  });

  it('이전 공 되불러오기: 지금 공과 맞바꾼다', () => {
    const store = new PieceStore(new MemoryStorage());
    const blue = makePiece('blue');
    const red = makePiece('red');
    store.moveCurrentToPrevious(blue);
    store.saveCurrent(red);
    expect(store.swapWithPrevious(red)).toEqual(roundTrip(blue));
    expect(store.loadCurrent()).toEqual(roundTrip(blue));
    expect(store.loadPrevious()).toEqual(roundTrip(red));
  });

  it('이전 공이 없으면 맞바꾸지 않는다', () => {
    const store = new PieceStore(new MemoryStorage());
    const red = makePiece('red');
    store.saveCurrent(red);
    expect(store.swapWithPrevious(red)).toBeNull();
    expect(store.loadCurrent()).toEqual(roundTrip(red));
  });

  it('새 점토를 두 번 누르면 첫 공은 사라진다 (한 칸만 보관, 알려진 한계)', () => {
    const store = new PieceStore(new MemoryStorage());
    store.moveCurrentToPrevious(makePiece('blue'));
    store.moveCurrentToPrevious(makePiece('red'));
    expect(new PaintState(store.loadPrevious()!.paint).getBlobs()[1].kind).toBe('red');
  });
});

describe('설정 (7A, 8A)', () => {
  it('저장이 없으면 기본값', () => {
    expect(new PieceStore(new MemoryStorage()).loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('소리 끔과 안내 횟수를 저장한다', () => {
    const store = new PieceStore(new MemoryStorage());
    store.savePrefs({ version: 1, muted: true, hintsShown: { mix: 2, press: 3 } });
    expect(store.loadPrefs()).toEqual({ version: 1, muted: true, hintsShown: { mix: 2, press: 3 } });
  });

  it('이상한 값은 기본값으로 고친다', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY_PREFS, JSON.stringify({ muted: 'yes', hintsShown: { mix: -4, press: 'x' } }));
    expect(new PieceStore(storage).loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('기본값 객체를 바꿔도 다음 기본값에 영향 없음', () => {
    const prefs = new PieceStore(new MemoryStorage()).loadPrefs();
    prefs.hintsShown.mix = 9;
    expect(DEFAULT_PREFS.hintsShown.mix).toBe(0);
  });
});

describe('저장소 실패에도 놀이는 계속된다', () => {
  it('용량 초과면 false를 돌려주고 예외를 던지지 않는다', () => {
    const store = new PieceStore(new FullStorage());
    expect(store.saveCurrent(makePiece('blue'))).toBe(false);
    expect(() => store.moveCurrentToPrevious(makePiece('blue'))).not.toThrow();
    expect(store.savePrefs(DEFAULT_PREFS)).toBe(false);
  });

  it('저장소가 아예 없으면(사생활 보호) 모두 비어 있는 것처럼 동작', () => {
    const store = new PieceStore(null);
    expect(store.saveCurrent(makePiece('blue'))).toBe(false);
    expect(store.loadCurrent()).toBeNull();
    expect(store.loadPrevious()).toBeNull();
    expect(store.loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('이전 공 키는 지금 공 키와 다르다', () => {
    expect(KEY_PREVIOUS).not.toBe(KEY_CURRENT);
  });

  it('작품 하나 저장 크기는 약 60KB 수준 (R9 추정 확인)', () => {
    const size = JSON.stringify(makePiece('blue')).length;
    expect(size).toBeGreaterThan(40_000);
    expect(size).toBeLessThan(80_000);
  });
});
