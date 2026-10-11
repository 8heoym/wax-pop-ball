import { beforeAll, describe, expect, it } from 'vitest';
import { ClayDeformer, createClayGeometry } from '../src/clay';
import { MarbleField, srgbToLinear } from '../src/marble';
import { createNoise3 } from '../src/noise';
import { PaintState, areaFraction, type Vec3 } from '../src/paint';
import type { TubeId } from '../src/palette';

let directions: Float32Array;
let count: number;

beforeAll(() => {
  const positions = createClayGeometry().getAttribute('position').array as Float32Array;
  directions = new ClayDeformer(positions).directions;
  count = directions.length / 3;
});

function squeeze(state: PaintState, tube: TubeId, seconds: number, center: Vec3 = [0, 1, 0]): void {
  state.startSqueeze(tube, center);
  state.updateSqueeze(seconds);
  state.endSqueeze();
}

function colors(field: MarbleField, state: PaintState): Float32Array {
  const out = new Float32Array(count * 3);
  field.computeSrgb(state.getBlobs(), state.finalLatent(), out);
  return out;
}

const rgbAt = (c: Float32Array, i: number) => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]];
const dist = (a: number[], b: readonly number[]) => Math.hypot(a[0] - b[0] / 255, a[1] - b[1] / 255, a[2] - b[2] / 255);

describe('노이즈', () => {
  it('같은 시드와 좌표면 같은 값, 시드가 다르면 다른 값', () => {
    const a = createNoise3(3);
    const b = createNoise3(3);
    const c = createNoise3(4);
    expect(a(0.3, 0.7, -1.2)).toBe(b(0.3, 0.7, -1.2));
    expect(a(0.3, 0.7, -1.2)).not.toBe(c(0.3, 0.7, -1.2));
  });

  it('값은 대략 -1~1', () => {
    const n = createNoise3(1);
    for (let i = 0; i < 1000; i++) {
      const v = n(i * 0.37, i * 0.11, i * -0.23);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('마블 무늬', () => {
  it('물감이 없으면 공 전체가 흰 점토색', () => {
    const state = new PaintState();
    const c = colors(new MarbleField(directions), state);
    const white = state.finalRgb();
    for (let i = 0; i < count; i += 97) expect(dist(rgbAt(c, i), white)).toBeLessThan(0.02);
  });

  it('젓기 전에는 물감 양만큼의 면적을 덮는다 (양 0.5 ≈ 10%, 양 3 ≈ 45%)', () => {
    for (const seconds of [0.5, 3]) {
      const state = new PaintState();
      squeeze(state, 'blue', seconds);
      const c = colors(new MarbleField(directions), state);
      const blue = state.getBlobs()[1];
      const blueRgb = [30, 90, 230];
      let covered = 0;
      for (let i = 0; i < count; i++) if (dist(rgbAt(c, i), blueRgb) < 0.05) covered++;
      // 경계가 부드럽게 섞여 순수 파랑은 목표보다 조금 적다
      const target = areaFraction(blue.amount);
      expect(covered / count).toBeGreaterThan(target - 0.08);
      expect(covered / count).toBeLessThan(target + 0.02);
    }
  });

  it('젓기 전 물감은 짠 자리 근처에 있고 반대편은 흰 점토', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 1, [0, 1, 0]);
    const c = colors(new MarbleField(directions), state);
    let topBlue = 0;
    let bottomBlue = 0;
    for (let i = 0; i < count; i++) {
      const isBlue = dist(rgbAt(c, i), [30, 90, 230]) < 0.1;
      if (directions[i * 3 + 1] > 0.5 && isBlue) topBlue++;
      if (directions[i * 3 + 1] < -0.5 && isBlue) bottomBlue++;
    }
    expect(topBlue).toBeGreaterThan(bottomBlue * 5);
  });

  it('모두 섞이면 공 전체가 최종 한 색', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    squeeze(state, 'yellow', 2, [1, 0, 0]);
    state.stir(12);
    const c = colors(new MarbleField(directions), state);
    const final = state.finalRgb();
    for (let i = 0; i < count; i++) expect(dist(rgbAt(c, i), final)).toBeLessThan(0.02);
  });

  it('결정적: 새 계산기로 다시 계산해도 같은 색 (저장 복원, 굽기 왕복, R10)', () => {
    const state = new PaintState();
    squeeze(state, 'red', 1.5);
    squeeze(state, 'pink', 1, [0, 0, 1]);
    state.stir(4);
    const first = colors(new MarbleField(directions), state);
    const field = new MarbleField(directions);
    colors(field, state);
    const again = colors(field, new PaintState(state.toSnapshot()));
    expect(Array.from(again)).toEqual(Array.from(first));
  });

  it('새 물감을 얹어도 그 영역 밖의 기존 무늬는 제자리 (R2-2)', () => {
    const state = new PaintState();
    squeeze(state, 'blue', 2);
    const field = new MarbleField(directions);
    const before = colors(field, state);
    squeeze(state, 'yellow', 1, [1, 0, 0]);
    const after = colors(field, state);
    const cover = field.coverage(state.getBlobs())[2];
    let compared = 0;
    for (let i = 0; i < count; i++) {
      if (cover[i] > 0) continue;
      compared++;
      expect(rgbAt(after, i)).toEqual(rgbAt(before, i));
    }
    expect(compared).toBeGreaterThan(count / 2);
  });

  it('덜어낸 덩어리 필드는 버린다', () => {
    const state = new PaintState();
    const field = new MarbleField(directions);
    squeeze(state, 'black', 3);
    colors(field, state);
    state.undoLastSqueeze();
    const c = colors(field, state);
    const white = state.finalRgb();
    for (let i = 0; i < count; i += 97) expect(dist(rgbAt(c, i), white)).toBeLessThan(0.02);
  });
});

describe('색 공간', () => {
  it('sRGB → 선형 변환', () => {
    const out = new Float32Array(3);
    srgbToLinear(new Float32Array([0, 0.5, 1]), out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.214, 3);
    expect(out[2]).toBeCloseTo(1, 5);
  });
});
