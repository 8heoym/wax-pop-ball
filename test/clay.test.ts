import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLAY_RADIUS,
  ClayDeformer,
  DENT_MAX_PER_PRESS,
  DENT_RADIUS,
  MIN_RADIUS,
  RESTORE_SECONDS,
  TAP_DENT_DEPTH,
  createClayGeometry,
  dentWeight,
  pressDepth,
} from '../src/clay';
import type { Vec3 } from '../src/paint';

let positions: Float32Array;
/** 위쪽에 가장 가까운 실제 꼭짓점 방향. 꼭짓점 위를 눌러야 중심 가중치가 정확히 1 */
let TOP: Vec3;

beforeAll(() => {
  positions = createClayGeometry().getAttribute('position').array as Float32Array;
  const clay = new ClayDeformer(positions);
  const i = nearestVertex(clay, [0, 1, 0]);
  TOP = [clay.directions[i * 3], clay.directions[i * 3 + 1], clay.directions[i * 3 + 2]];
});

const newClay = () => new ClayDeformer(positions);

/** 방향 d와 가장 가까운 꼭짓점 */
function nearestVertex(clay: ClayDeformer, d: Vec3): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < clay.vertexCount; i++) {
    const dot = clay.directions[i * 3] * d[0] + clay.directions[i * 3 + 1] * d[1] + clay.directions[i * 3 + 2] * d[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

function hold(clay: ClayDeformer, point: Vec3, seconds: number): void {
  clay.beginPress(point);
  clay.updatePress(seconds);
  clay.endPress();
}

const minRadius = (clay: ClayDeformer) => clay.radii.reduce((m, r) => Math.min(m, r), Infinity);

describe('점토 메쉬 (D3)', () => {
  it('이음매 없는 구: 약 1.1만 꼭짓점, 모두 반지름 R 위, UV 없음', () => {
    const geometry = createClayGeometry();
    const count = geometry.getAttribute('position').count;
    expect(count).toBeGreaterThan(10_000);
    expect(count).toBeLessThan(12_000);
    expect(geometry.getAttribute('uv')).toBeUndefined();
    const clay = newClay();
    expect(clay.vertexCount).toBe(count);
    expect(clay.isDented()).toBe(false);
  });
});

describe('자국 모양', () => {
  it.each([
    [0, 1],
    [DENT_RADIUS * 0.5, Math.exp(-1)],
    [DENT_RADIUS * 0.999, Math.exp(-4 * 0.999 ** 2)],
    [DENT_RADIUS, 0],
    [DENT_RADIUS * 2, 0],
  ])('중심에서 %s 떨어지면 가중치 %s', (distance, weight) => {
    expect(dentWeight(distance)).toBeCloseTo(weight, 5);
  });

  it.each([
    [0, 0],
    [1, 0.15],
    [2, 0.3],
    [10, 0.3],
    [-1, 0],
  ])('%s초 누르면 깊이 %s (초당 0.15R, 1회 최대 0.3R)', (seconds, depth) => {
    expect(pressDepth(seconds)).toBeCloseTo(depth * CLAY_RADIUS);
  });
});

describe('누르기', () => {
  it('누른 자리가 들어가고 반경 밖은 그대로', () => {
    const clay = newClay();
    hold(clay, TOP, 1);
    const center = nearestVertex(clay, TOP);
    expect(clay.radii[center]).toBeCloseTo(CLAY_RADIUS - 0.15, 2);
    const far = nearestVertex(clay, [0, -1, 0]);
    expect(clay.radii[far]).toBe(CLAY_RADIUS);
    const side = nearestVertex(clay, [1, 0, 0]);
    expect(clay.radii[side]).toBe(CLAY_RADIUS);
  });

  it('같은 누르기 안에서 프레임마다 깊이가 누적되지 않는다', () => {
    const clay = newClay();
    clay.beginPress(TOP);
    for (let t = 0; t <= 1; t += 1 / 60) clay.updatePress(t);
    clay.updatePress(1);
    clay.endPress();
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(CLAY_RADIUS - 0.15, 2);
  });

  it('한 번 누를 때 아무리 오래 눌러도 최대 0.3R', () => {
    const clay = newClay();
    hold(clay, TOP, 60);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(CLAY_RADIUS - DENT_MAX_PER_PRESS, 2);
  });

  it('짧은 탭은 0.05R 작은 자국', () => {
    const clay = newClay();
    clay.tap(TOP);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(CLAY_RADIUS - TAP_DENT_DEPTH, 2);
  });

  it('여러 번 누르면 누적되지만 어떤 꼭짓점도 0.55R보다 안쪽으로 가지 않는다', () => {
    const clay = newClay();
    hold(clay, TOP, 2);
    const afterOne = clay.radii[nearestVertex(clay, TOP)];
    hold(clay, TOP, 2);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeLessThan(afterOne);
    for (let k = 0; k < 10; k++) hold(clay, TOP, 2);
    expect(minRadius(clay)).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(MIN_RADIUS, 5);
  });

  it('어떤 꼭짓점도 원래 반지름보다 튀어나오지 않는다', () => {
    const clay = newClay();
    for (const p of [TOP, [1, 0, 0], [0, 0, 1], [0.6, 0.8, 0]] as Vec3[]) hold(clay, p, 3);
    expect(clay.radii.every((r) => r <= CLAY_RADIUS)).toBe(true);
  });

  it('자국은 누르기 시작점에 고정된다 (방향이 정규화되지 않아도)', () => {
    const clay = newClay();
    hold(clay, [TOP[0] * 5, TOP[1] * 5, TOP[2] * 5], 1);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(CLAY_RADIUS - 0.15, 2);
  });

  it('누르기가 취소돼도 이미 생긴 자국은 남는다', () => {
    const clay = newClay();
    clay.beginPress(TOP);
    clay.updatePress(1);
    clay.cancelPress();
    expect(clay.updatePress(2)).toBe(false);
    expect(clay.radii[nearestVertex(clay, TOP)]).toBeCloseTo(CLAY_RADIUS - 0.15, 2);
  });
});

describe('다시 동그랗게', () => {
  it('0.5초 동안 돌아가고 끝나면 정확히 원래 구', () => {
    const clay = newClay();
    hold(clay, TOP, 2);
    hold(clay, [1, 0, 0], 1);
    const dented = clay.radii[nearestVertex(clay, TOP)];
    clay.beginRestore();
    expect(clay.updateRestore(RESTORE_SECONDS / 2)).toBe(true);
    const mid = clay.radii[nearestVertex(clay, TOP)];
    expect(mid).toBeGreaterThan(dented);
    expect(mid).toBeLessThan(CLAY_RADIUS);
    expect(clay.updateRestore(RESTORE_SECONDS)).toBe(false);
    expect(clay.radii.every((r) => r === CLAY_RADIUS)).toBe(true);
    expect(clay.isDented()).toBe(false);
    expect(clay.isRestoring()).toBe(false);
  });

  it('위치도 원래 꼭짓점과 같다', () => {
    const clay = newClay();
    hold(clay, TOP, 2);
    clay.beginRestore();
    clay.updateRestore(RESTORE_SECONDS);
    const out = new Float32Array(positions.length);
    clay.writePositions(out);
    out.forEach((v, k) => expect(v).toBeCloseTo(positions[k], 5));
  });
});

describe('저장 (D6)', () => {
  it('반지름 왕복 후 같은 모양', () => {
    const clay = newClay();
    hold(clay, TOP, 2);
    clay.tap([1, 0, 0]);
    const restored = newClay();
    expect(restored.restoreRadii(clay.serializeRadii())).toBe(true);
    expect(Array.from(restored.radii)).toEqual(Array.from(clay.radii));
  });

  it.each<[string, () => unknown]>([
    ['문자열 아님', () => 42],
    ['base64 아님', () => '%%%'],
    ['꼭짓점 수 다름', () => btoa('abcd')],
    [
      '범위 밖 반지름',
      () => {
        const bad = new Float32Array(positions.length / 3).fill(0.1);
        return btoa(String.fromCharCode(...new Uint8Array(bad.buffer)));
      },
    ],
  ])('손상 데이터 거부: %s', (_name, make) => {
    const clay = newClay();
    hold(clay, TOP, 1);
    const before = Array.from(clay.radii);
    expect(clay.restoreRadii(make())).toBe(false);
    expect(Array.from(clay.radii)).toEqual(before);
  });
});
