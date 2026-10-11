import { describe, expect, it } from 'vitest';
import {
  MAX_BLOBS,
  STIR_DISTANCE_FOR_FULL_MIX as FULL,
  PaintState,
  areaFraction,
  parsePaintSnapshot,
  squeezeAmount,
  type Vec3,
} from '../src/paint';
import type { TubeId } from '../src/palette';

const TOP: Vec3 = [0, 1, 0];

/** 튜브를 heldSeconds 동안 누르고 뗀다 */
function squeeze(state: PaintState, tube: TubeId, heldSeconds: number, center: Vec3 = TOP): void {
  state.startSqueeze(tube, center);
  state.updateSqueeze(heldSeconds);
  state.endSqueeze();
}

const paintBlobs = (state: PaintState) => state.getBlobs().slice(1);

describe('짜기 양 (D7)', () => {
  it.each([
    [0, 0.25],
    [0.1, 0.25],
    [0.5, 0.5],
    [1.5, 1.5],
    [3, 3],
    [10, 3],
  ])('%s초 누르면 양 %s', (held, expected) => {
    expect(squeezeAmount(held)).toBeCloseTo(expected);
  });

  it('누르는 동안 양이 실시간으로 늘어난다 (4A 리본)', () => {
    const state = new PaintState();
    state.startSqueeze('red', TOP);
    expect(state.updateSqueeze(0.2)).toBeCloseTo(0.25);
    expect(state.updateSqueeze(1.2)).toBeCloseTo(1.2);
    expect(paintBlobs(state)[0].amount).toBeCloseTo(1.2);
    expect(state.isSqueezeMaxed(2.9)).toBe(false);
    expect(state.isSqueezeMaxed(3)).toBe(true);
  });
});

describe('영역 비율', () => {
  it.each([
    [0.5, 0.1],
    [3, 0.45],
    [1.75, 0.275],
    [0.25, 0.065],
  ])('양 %s → 표면 %s', (amount, fraction) => {
    expect(areaFraction(amount)).toBeCloseTo(fraction);
  });
});

describe('새 점토', () => {
  it('흰 바탕 하나로 시작하고 섞임 상태가 아니다', () => {
    const state = new PaintState();
    expect(state.getBlobs()).toHaveLength(1);
    expect(state.getBlobs()[0].kind).toBe('clay');
    expect(state.isFullyMixed()).toBe(false);
  });
});

describe('젓기 (p += 거리/FULL)', () => {
  it('p는 0~1로 오르고 되돌아가지 않는다', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    state.stir(FULL / 2);
    expect(paintBlobs(state)[0].p).toBeCloseTo(0.5);
    state.stir(0);
    state.stir(-3);
    expect(paintBlobs(state)[0].p).toBeCloseTo(0.5);
    state.stir(100);
    expect(paintBlobs(state)[0].p).toBe(1);
  });

  it('새로 짠 덩어리는 p=0에서 시작하고 기존 p는 그대로', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    state.stir(FULL / 2);
    squeeze(state, 'yellow', 2);
    const [blue, yellow] = paintBlobs(state);
    expect(blue.p).toBeCloseTo(0.5);
    expect(yellow.p).toBe(0);
  });

  it('모두 섞이는 순간에만 true를 한 번 반환한다 (6A)', () => {
    const state = new PaintState();
    expect(state.stir(20)).toBe(false); // 물감 없음
    squeeze(state, 'blue', 2);
    squeeze(state, 'yellow', 2);
    expect(state.stir(FULL - 1)).toBe(false);
    expect(state.stir(1)).toBe(true);
    expect(state.stir(5)).toBe(false);
    expect(state.isFullyMixed()).toBe(true);
  });
});

describe('최종 색', () => {
  it('흰 점토도 양 비례로 섞여, 물감이 적으면 연하고 많으면 진하다', () => {
    const little = new PaintState();
    squeeze(little, 'blue', 0.25);
    const lots = new PaintState();
    squeeze(lots, 'blue', 3);
    const brightness = (rgb: readonly number[]) => rgb[0] + rgb[1] + rgb[2];
    expect(brightness(little.finalRgb())).toBeGreaterThan(brightness(lots.finalRgb()));
  });
});

describe('덩어리 최대 8개', () => {
  function fillToMax(state: PaintState): void {
    const tubes: TubeId[] = ['red', 'pink', 'yellow', 'blue', 'black', 'white', 'red'];
    for (const tube of tubes) squeeze(state, tube, 1);
    expect(state.getBlobs()).toHaveLength(MAX_BLOBS);
  }

  it('같은 색 p=0 덩어리가 있으면 거기에 양을 더한다', () => {
    const state = new PaintState();
    fillToMax(state);
    const redBefore = paintBlobs(state).find((b) => b.kind === 'red')!.amount;
    squeeze(state, 'red', 1);
    expect(state.getBlobs()).toHaveLength(MAX_BLOBS);
    expect(paintBlobs(state).find((b) => b.kind === 'red')!.amount).toBeCloseTo(redBefore + 1);
  });

  it('없으면 흰 바탕을 뺀 가장 많이 섞인 두 덩어리를 합치고, 최종 색은 그대로', () => {
    const state = new PaintState();
    fillToMax(state);
    state.stir(FULL / 4); // 모든 물감 p=0.25 → 동점이면 오래된 두 덩어리(red, pink)
    const beforeLatent = state.finalLatent();
    const clayBefore = state.getBlobs()[0];

    // 합치기는 짜기 시작 시점에 일어난다. 같은 색 p=0이 없도록 모두 저은 뒤 노랑을 짠다
    state.startSqueeze('yellow', TOP);
    const blobs = state.getBlobs();
    expect(blobs).toHaveLength(MAX_BLOBS);
    expect(blobs[0]).toBe(clayBefore);
    expect(blobs[1].kind).toBe('mixed');
    expect(blobs[1].seed).toBe(1);
    expect(blobs[1].amount).toBeCloseTo(2);
    expect(blobs.filter((b) => b.kind === 'pink')).toHaveLength(0);

    // 새 노랑을 빼고 계산하면 합치기 전과 같은 최종 색 (latent 합산 보관, R3-12)
    state.updateSqueeze(0);
    state.endSqueeze();
    state.undoLastSqueeze();
    const afterLatent = state.finalLatent();
    afterLatent.forEach((v, k) => expect(v).toBeCloseTo(beforeLatent[k], 10));
  });

  it('섞임 정도가 다르면 가장 많이 섞인 두 덩어리를 고른다', () => {
    const state = new PaintState();
    squeeze(state, 'red', 1);
    squeeze(state, 'pink', 1);
    state.stir(FULL / 2); // red, pink만 p=0.5
    for (const tube of ['yellow', 'blue', 'black', 'white', 'red'] as TubeId[]) squeeze(state, tube, 1);
    expect(state.getBlobs()).toHaveLength(MAX_BLOBS);

    state.startSqueeze('pink', TOP); // pink는 p=0.5라 같은 색 p=0 아님 → 합치기
    const kinds = state.getBlobs().map((b) => b.kind);
    expect(kinds).toEqual(['clay', 'mixed', 'yellow', 'blue', 'black', 'white', 'red', 'pink']);
    expect(state.getBlobs()[1].p).toBeCloseTo(0.5);
  });

  it('흰 바탕은 p가 같아도 절대 합치지 않는다', () => {
    const state = new PaintState();
    fillToMax(state);
    state.stir(100);
    state.startSqueeze('yellow', TOP);
    expect(state.getBlobs()[0].kind).toBe('clay');
    expect(state.getBlobs().filter((b) => b.kind === 'clay')).toHaveLength(1);
  });
});

describe('덜어내기 (11A)', () => {
  it('방금 짠 물감을 젓기 전이면 지울 수 있다', () => {
    const state = new PaintState();
    squeeze(state, 'black', 3);
    expect(state.canUndoLastSqueeze()).toBe(true);
    expect(state.undoLastSqueeze()).toBe(true);
    expect(state.getBlobs()).toHaveLength(1);
    expect(state.canUndoLastSqueeze()).toBe(false);
  });

  it('조금이라도 저었으면 덜어낼 수 없다', () => {
    const state = new PaintState();
    squeeze(state, 'black', 3);
    state.stir(0.1);
    expect(state.canUndoLastSqueeze()).toBe(false);
    expect(state.undoLastSqueeze()).toBe(false);
    expect(state.getBlobs()).toHaveLength(2);
  });

  it('짜는 중에는 덜어낼 수 없다', () => {
    const state = new PaintState();
    state.startSqueeze('red', TOP);
    expect(state.canUndoLastSqueeze()).toBe(false);
  });

  it('같은 색 덩어리에 더한 경우 더한 양만 되돌린다', () => {
    const state = new PaintState();
    for (const tube of ['red', 'pink', 'yellow', 'blue', 'black', 'white', 'red'] as TubeId[]) squeeze(state, tube, 1);
    squeeze(state, 'blue', 2);
    expect(state.undoLastSqueeze()).toBe(true);
    expect(paintBlobs(state).find((b) => b.kind === 'blue')!.amount).toBeCloseTo(1);
    expect(state.getBlobs()).toHaveLength(MAX_BLOBS);
  });
});

describe('덩어리 중심 (R13)', () => {
  it('짜기 시작 때 받은 공 좌표를 그대로 보관한다', () => {
    const state = new PaintState();
    const center: Vec3 = [0.6, 0.8, 0];
    squeeze(state, 'pink', 1, center);
    expect(paintBlobs(state)[0].center).toEqual(center);
  });
});

describe('저장 형식', () => {
  it('스냅샷 왕복 후 같은 상태', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    squeeze(state, 'yellow', 1.5);
    state.stir(4);
    const json = JSON.parse(JSON.stringify(state.toSnapshot()));
    const parsed = parsePaintSnapshot(json);
    expect(parsed).not.toBeNull();
    const restored = new PaintState(parsed!);
    expect(restored.toSnapshot()).toEqual(state.toSnapshot());
    expect(restored.finalRgb()).toEqual(state.finalRgb());
  });

  it('복원한 상태를 바꿔도 원본 스냅샷은 바뀌지 않는다', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    const snapshot = state.toSnapshot();
    const restored = new PaintState(snapshot);
    restored.stir(FULL);
    expect(snapshot.blobs[1].p).toBe(0);
  });

  const valid = () => JSON.parse(JSON.stringify(new PaintState().toSnapshot()));
  it.each<[string, (s: any) => unknown]>([
    ['null', () => null],
    ['문자열', () => 'hello'],
    ['버전 다름', (s) => ({ ...s, version: 2 })],
    ['덩어리 없음', (s) => ({ ...s, blobs: [] })],
    ['덩어리 9개', (s) => ({ ...s, blobs: Array(9).fill(s.blobs[0]) })],
    ['첫 덩어리가 흰 바탕 아님', (s) => ({ ...s, blobs: [{ ...s.blobs[0], kind: 'red' }] })],
    ['알 수 없는 색', (s) => ({ ...s, blobs: [s.blobs[0], { ...s.blobs[0], kind: 'gold' }] })],
    ['latent 길이 틀림', (s) => ({ ...s, blobs: [{ ...s.blobs[0], latent: [1, 2] }] })],
    ['p 범위 밖', (s) => ({ ...s, blobs: [{ ...s.blobs[0], p: 1.5 }] })],
    ['양 0', (s) => ({ ...s, blobs: [{ ...s.blobs[0], amount: 0 }] })],
    ['NaN', (s) => ({ ...s, blobs: [{ ...s.blobs[0], amount: NaN }] })],
    ['시드가 nextSeed 이상', (s) => ({ ...s, nextSeed: 0 })],
  ])('손상 데이터 거부: %s', (_name, corrupt) => {
    expect(parsePaintSnapshot(corrupt(valid()))).toBeNull();
  });
});
