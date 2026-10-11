// 마블 무늬: 꼭짓점마다 색을 계산한다 (설계 문서 "마블 표시"/"영역 배정", T5).
//
// 원래 계획은 섞기 모드에서 GPU 셰이더, 완성 시 CPU 굽기였지만(D4/D10), 같은 노이즈를
// GLSL과 JS로 두 번 구현하면 둘의 일치를 보장하기 어렵다. 그래서 무늬는 처음부터 끝까지
// 여기서 꼭짓점 색으로 계산하고, 화면은 그 색을 보여주기만 한다. "굽기"는 이 결과를 그대로 쓰는 것이라
// 왕복해도 항상 같다 (Eng re-review R10).
//
// 덩어리 하나의 영역 점수 = (1-p)·근접도 + 노이즈(p가 클수록 가는 무늬).
// 점수 상위 areaFraction(양) 비율의 꼭짓점이 그 덩어리 영역이다. 덩어리별 노이즈는 시드로 고정되어
// 새 물감을 넣어도 기존 무늬는 제자리에 있다 (R2-2). 나중에 넣은 물감이 위에 얹힌다.
import { areaFraction, latentToRgb, type Blob, type Latent } from './paint';
import { createNoise3 } from './noise';

/** 영역 경계를 부드럽게 섞는 폭 (점수 단위) */
const EDGE_SOFTNESS = 0.03;
const LOW_FREQUENCY = 1.4;
const HIGH_FREQUENCY = 4.2;
const WARP = 0.55;

interface BlobField {
  closeness: Float32Array;
  low: Float32Array;
  high: Float32Array;
}

export class MarbleField {
  private readonly fields = new Map<number, BlobField>();
  private readonly count: number;
  private readonly scores: Float32Array;
  private readonly sorted: Float32Array;

  constructor(private readonly directions: Float32Array) {
    this.count = directions.length / 3;
    this.scores = new Float32Array(this.count);
    this.sorted = new Float32Array(this.count);
  }

  /** 덩어리 시드별 노이즈 필드. 덩어리가 처음 보일 때 한 번만 계산 */
  private field(blob: Readonly<Blob>): BlobField {
    const cached = this.fields.get(blob.seed);
    if (cached) return cached;
    const noise = createNoise3(blob.seed);
    const warp = createNoise3(blob.seed + 7919);
    const [cx, cy, cz] = blob.center;
    const len = Math.hypot(cx, cy, cz) || 1;
    // 덩어리마다 다른 방향으로 늘어난 줄무늬가 되도록 축별 배율을 시드로 정한다
    const stretch = 1 + ((blob.seed * 0.618) % 1);
    const field: BlobField = {
      closeness: new Float32Array(this.count),
      low: new Float32Array(this.count),
      high: new Float32Array(this.count),
    };
    const d = this.directions;
    for (let i = 0; i < this.count; i++) {
      const x = d[i * 3];
      const y = d[i * 3 + 1];
      const z = d[i * 3 + 2];
      field.closeness[i] = (x * cx + y * cy + z * cz) / len;
      const wx = warp(x * 1.1, y * 1.1, z * 1.1) * WARP;
      const wy = warp(y * 1.1 + 31.7, z * 1.1, x * 1.1) * WARP;
      const wz = warp(z * 1.1 + 57.3, x * 1.1, y * 1.1) * WARP;
      const sx = (x + wx) * stretch;
      const sy = y + wy;
      const sz = (z + wz) / stretch;
      field.low[i] = noise(sx * LOW_FREQUENCY, sy * LOW_FREQUENCY, sz * LOW_FREQUENCY);
      field.high[i] = noise(sx * HIGH_FREQUENCY + 101, sy * HIGH_FREQUENCY, sz * HIGH_FREQUENCY);
    }
    this.fields.set(blob.seed, field);
    return field;
  }

  /** 사라진 덩어리(덜어내기, 새 점토)의 필드를 버린다 */
  private prune(blobs: readonly Readonly<Blob>[]): void {
    const alive = new Set(blobs.map((b) => b.seed));
    for (const seed of this.fields.keys()) if (!alive.has(seed)) this.fields.delete(seed);
  }

  /**
   * 꼭짓점별 덩어리 덮임 정도(0~1)를 계산한다. coverage[b][i]
   * 흰 바탕(blobs[0])은 항상 1이고 나머지가 그 위에 순서대로 얹힌다.
   */
  coverage(blobs: readonly Readonly<Blob>[]): Float32Array[] {
    this.prune(blobs);
    const result: Float32Array[] = [new Float32Array(this.count).fill(1)];
    for (const blob of blobs.slice(1)) {
      const field = this.field(blob);
      const p = blob.p;
      const locality = 0.6 * (1 - p);
      for (let i = 0; i < this.count; i++) {
        const noise = field.low[i] * (1 - p) + field.high[i] * p;
        this.scores[i] = locality * field.closeness[i] + (1 - locality) * 0.6 * noise;
      }
      // 점수 상위 areaFraction(양) 비율이 영역이 되도록 임계값을 고른다
      this.sorted.set(this.scores);
      this.sorted.sort();
      const rank = Math.min(this.count - 1, Math.floor((1 - areaFraction(blob.amount)) * this.count));
      const threshold = this.sorted[rank];
      const cover = new Float32Array(this.count);
      for (let i = 0; i < this.count; i++) {
        cover[i] = smoothstep(threshold - EDGE_SOFTNESS, threshold + EDGE_SOFTNESS, this.scores[i]);
      }
      result.push(cover);
    }
    return result;
  }

  /**
   * 꼭짓점 색(sRGB 0~1, rgb 반복)을 out에 쓴다.
   * 각 덩어리 색은 p만큼 최종 한 색 쪽으로 Mixbox 보간되고, 흰 바탕은 가장 많이 섞인 물감의 p를 따른다.
   */
  computeSrgb(blobs: readonly Readonly<Blob>[], finalLatent: Latent, out: Float32Array): void {
    const covers = this.coverage(blobs);
    const paints = blobs.slice(1);
    const baseP = paints.reduce((max, b) => Math.max(max, b.p), 0);
    const layerLatents = blobs.map((b, index) => lerpLatent(b.latent, finalLatent, index === 0 ? baseP : b.p));
    const layerRgb = layerLatents.map((latent) => latentToRgb(latent));
    const size = finalLatent.length;
    const latent = new Array<number>(size);

    for (let i = 0; i < this.count; i++) {
      // 대부분의 꼭짓점은 덩어리 하나에 완전히 덮이거나 안 덮였다: 맨 위 덩어리 색을 그대로 쓴다
      let top = 0;
      let soft = false;
      for (let b = 1; b < covers.length; b++) {
        const c = covers[b][i];
        if (c >= 1) {
          top = b;
          soft = false;
        } else if (c > 0) {
          soft = true;
        }
      }
      let rgb;
      if (!soft) {
        rgb = layerRgb[top];
      } else {
        for (let k = 0; k < size; k++) latent[k] = layerLatents[top][k];
        for (let b = top + 1; b < covers.length; b++) {
          const c = covers[b][i];
          if (c <= 0) continue;
          for (let k = 0; k < size; k++) latent[k] += (layerLatents[b][k] - latent[k]) * c;
        }
        rgb = latentToRgb(latent);
      }
      out[i * 3] = rgb[0] / 255;
      out[i * 3 + 1] = rgb[1] / 255;
      out[i * 3 + 2] = rgb[2] / 255;
    }
  }
}

function lerpLatent(from: Latent, to: Latent, t: number): Latent {
  return from.map((v, k) => v + (to[k] - v) * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** sRGB 0~1 → 선형 (Three.js 꼭짓점 색은 선형 공간) */
export function srgbToLinear(srgb: Float32Array, out: Float32Array): void {
  for (let i = 0; i < srgb.length; i++) {
    const c = srgb[i];
    out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
}
