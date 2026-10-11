// 물감 덩어리 모델 (설계 문서 "색 섞기 모델", Eng review D4/D7, Design review 4A/6A/11A, Eng re-review R13).
// Three.js와 무관한 순수 계산만 둔다. 화면(셰이더, 리본 애니메이션)은 main.ts에서 이 상태를 읽어 그린다.
import mixbox from 'mixbox';
import { CLAY_WHITE, TUBES, type Rgb, type TubeId } from './palette';

export type Latent = number[];
export type Vec3 = readonly [number, number, number];

export interface Blob {
  /** 'clay'는 흰 점토 바탕(항상 첫 항목), 'mixed'는 9번째 물감 때 합쳐진 덩어리 */
  readonly kind: TubeId | 'clay' | 'mixed';
  /** Mixbox latent. 합친 덩어리도 latent 그대로 보관해 최종 색이 변하지 않게 한다 (R3-12) */
  latent: Latent;
  amount: number;
  /** 섞임 정도 0~1, 되돌아가지 않음 */
  p: number;
  /** 덩어리별 노이즈 시드. 결정적 굽기를 위해 난수 대신 증가 카운터 (R10) */
  readonly seed: number;
  /** 리본이 떨어진 곳, 공의 원래 좌표계 단위 벡터 (R13). 흰 바탕은 [0,0,0] */
  readonly center: Vec3;
}

export interface PaintSnapshot {
  version: 1;
  blobs: Blob[];
  nextSeed: number;
}

interface SqueezeRecord {
  blob: Blob;
  baseAmount: number;
  created: boolean;
}

export const MAX_BLOBS = 8;
export const MIN_SQUEEZE = 0.25;
export const SQUEEZE_PER_SECOND = 1.0;
export const MAX_SQUEEZE = 3;
/**
 * 이동 거리(화면 짧은 변 = 1) 8만큼 저으면 p가 0 → 1.
 * 1A 배치에서 공 반지름은 짧은 변의 27.5%라, 공 위의 큰 원(반지름 약 0.2) 둘레가 약 1.3.
 * "큰 원 약 6바퀴"(설계 문서)에 맞춰 8로 정함. 처음 값 12는 공보다 큰 원 기준이었다.
 */
export const STIR_DISTANCE_FOR_FULL_MIX = 8;
const CLAY_AMOUNT = 1;

/** 짜고 있는 시간(초) → 양. 짧은 탭도 최소 0.25, 최대 3 (D7) */
export function squeezeAmount(heldSeconds: number): number {
  return Math.min(MAX_SQUEEZE, Math.max(MIN_SQUEEZE, heldSeconds * SQUEEZE_PER_SECOND));
}

/** 양 → 표면에서 차지하는 비율. 양 0.5 ≈ 10%, 양 3 ≈ 45% 사이 선형 (설계 문서 영역 배정) */
export function areaFraction(amount: number): number {
  return Math.min(0.45, Math.max(0.05, 0.1 + (amount - 0.5) * (0.35 / 2.5)));
}

export function rgbToLatent(rgb: Rgb): Latent {
  return mixbox.rgbToLatent(rgb[0], rgb[1], rgb[2]);
}

export function latentToRgb(latent: Latent): Rgb {
  const rgb = mixbox.latentToRgb(latent);
  return [rgb[0], rgb[1], rgb[2]];
}

function weightedLatent(parts: ReadonlyArray<{ latent: Latent; amount: number }>): Latent {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const result = new Array<number>(mixbox.LATENT_SIZE).fill(0);
  for (const part of parts) {
    part.latent.forEach((v, k) => (result[k] += (part.amount / total) * v));
  }
  return result;
}

export class PaintState {
  private blobs: Blob[];
  private nextSeed: number;
  /** 지금 짜고 있는 덩어리와 짜기 전 양 (같은 색 p=0 덩어리에 더하는 경우 기존 양) */
  private squeezing: SqueezeRecord | null = null;
  /** 마지막으로 끝난 짜기. 덜어내기는 이것만 되돌린다 (11A) */
  private lastSqueeze: SqueezeRecord | null = null;

  constructor(snapshot?: PaintSnapshot) {
    if (snapshot) {
      this.blobs = snapshot.blobs.map((b) => ({ ...b, latent: [...b.latent] }));
      this.nextSeed = snapshot.nextSeed;
    } else {
      this.blobs = [{ kind: 'clay', latent: rgbToLatent(CLAY_WHITE), amount: CLAY_AMOUNT, p: 0, seed: 0, center: [0, 0, 0] }];
      this.nextSeed = 1;
    }
  }

  getBlobs(): readonly Readonly<Blob>[] {
    return this.blobs;
  }

  /** 흰 바탕을 제외한 물감 덩어리 */
  private paintBlobs(): Blob[] {
    return this.blobs.slice(1);
  }

  /**
   * 튜브를 누르기 시작. center는 카메라 위쪽 광선과 공의 교점을 공의 원래 좌표로 바꾼 값 (R13).
   * 덩어리가 이미 8개면: 같은 색 p=0 덩어리에 더하고, 없으면 가장 많이 섞인 두 물감 덩어리를 합친 뒤 추가.
   */
  startSqueeze(tube: TubeId, center: Vec3): void {
    if (this.squeezing) this.endSqueeze();
    if (this.blobs.length >= MAX_BLOBS) {
      const sameColor = this.paintBlobs().find((b) => b.kind === tube && b.p === 0);
      if (sameColor) {
        this.squeezing = { blob: sameColor, baseAmount: sameColor.amount, created: false };
        sameColor.amount += MIN_SQUEEZE;
        return;
      }
      this.mergeTwoMostMixed();
    }
    const blob: Blob = {
      kind: tube,
      latent: rgbToLatent(TUBES[tube]),
      amount: MIN_SQUEEZE,
      p: 0,
      seed: this.nextSeed++,
      center,
    };
    this.blobs.push(blob);
    this.squeezing = { blob, baseAmount: 0, created: true };
  }

  /** 누르고 있는 동안 매 프레임 호출. 리본 길이는 반환된 양으로 그린다 (4A) */
  updateSqueeze(heldSeconds: number): number {
    if (!this.squeezing) return 0;
    const added = squeezeAmount(heldSeconds);
    this.squeezing.blob.amount = this.squeezing.baseAmount + added;
    return added;
  }

  /** 짜는 양이 최대(3)에 도달했는지. 튜브 부르르 연출용 (4A) */
  isSqueezeMaxed(heldSeconds: number): boolean {
    return heldSeconds * SQUEEZE_PER_SECOND >= MAX_SQUEEZE;
  }

  endSqueeze(): void {
    this.lastSqueeze = this.squeezing;
    this.squeezing = null;
  }

  /**
   * 9번째 물감: 흰 바탕을 제외한 물감 중 p가 가장 큰 두 덩어리를 합친다 (동점이면 오래된 것).
   * 합친 덩어리: latent는 양 비례 합, 양은 합, p는 작은 값, 시드와 중심은 먼저 넣은 쪽.
   */
  private mergeTwoMostMixed(): void {
    const ranked = this.paintBlobs()
      .map((blob, order) => ({ blob, order }))
      .sort((a, b) => b.blob.p - a.blob.p || a.order - b.order)
      .slice(0, 2)
      .sort((a, b) => a.order - b.order);
    const [first, second] = ranked.map((r) => r.blob);
    const merged: Blob = {
      kind: 'mixed',
      latent: weightedLatent([first, second]),
      amount: first.amount + second.amount,
      p: Math.min(first.p, second.p),
      seed: first.seed,
      center: first.center,
    };
    const firstIndex = this.blobs.indexOf(first);
    this.blobs[firstIndex] = merged;
    this.blobs.splice(this.blobs.indexOf(second), 1);
  }

  /**
   * 공 위에서 손가락이 움직인 거리(화면 짧은 변 = 1)만큼 젓는다. 모든 물감 덩어리 p가 같이 오른다.
   * 반환값: 이번 젓기로 "모두 섞임"이 처음 된 경우 true (6A 반짝 + 완성 두근 신호)
   */
  stir(distance: number): boolean {
    if (distance <= 0) return false;
    const wasFull = this.isFullyMixed();
    for (const blob of this.paintBlobs()) {
      blob.p = Math.min(1, blob.p + distance / STIR_DISTANCE_FOR_FULL_MIX);
    }
    return !wasFull && this.isFullyMixed();
  }

  /** 물감이 하나 이상 있고 모두 p=1 */
  isFullyMixed(): boolean {
    const paints = this.paintBlobs();
    return paints.length > 0 && paints.every((b) => b.p >= 1);
  }

  /** 최종 한 색: 흰 바탕 포함 모든 덩어리를 양 비례로 Mixbox 혼합 */
  finalLatent(): Latent {
    return weightedLatent(this.blobs);
  }

  finalRgb(): Rgb {
    return latentToRgb(this.finalLatent());
  }

  /** 덜어내기: 방금 짠 물감이 아직 그대로(젓지 않음, 합쳐지지 않음)일 때만 (11A) */
  canUndoLastSqueeze(): boolean {
    const last = this.lastSqueeze;
    return this.squeezing === null && last !== null && last.blob.p === 0 && this.blobs.includes(last.blob);
  }

  undoLastSqueeze(): boolean {
    if (!this.canUndoLastSqueeze()) return false;
    const { blob, baseAmount, created } = this.lastSqueeze!;
    if (created) {
      this.blobs.splice(this.blobs.indexOf(blob), 1);
    } else {
      blob.amount = baseAmount;
    }
    this.lastSqueeze = null;
    return true;
  }

  toSnapshot(): PaintSnapshot {
    return {
      version: 1,
      blobs: this.blobs.map((b) => ({ ...b, latent: [...b.latent] })),
      nextSeed: this.nextSeed,
    };
  }
}

const BLOB_KINDS = new Set<string>(['clay', 'mixed', ...Object.keys(TUBES)]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 저장된 물감 상태 검증. 하나라도 이상하면 null (D6: 버리고 새 점토) */
export function parsePaintSnapshot(value: unknown): PaintSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const { version, blobs, nextSeed } = value as Record<string, unknown>;
  if (version !== 1 || !Array.isArray(blobs) || !isFiniteNumber(nextSeed)) return null;
  if (blobs.length < 1 || blobs.length > MAX_BLOBS) return null;
  for (const [index, raw] of blobs.entries()) {
    if (typeof raw !== 'object' || raw === null) return null;
    const b = raw as Record<string, unknown>;
    if (typeof b.kind !== 'string' || !BLOB_KINDS.has(b.kind)) return null;
    if ((index === 0) !== (b.kind === 'clay')) return null;
    if (!Array.isArray(b.latent) || b.latent.length !== mixbox.LATENT_SIZE || !b.latent.every(isFiniteNumber)) return null;
    if (!isFiniteNumber(b.amount) || b.amount <= 0) return null;
    if (!isFiniteNumber(b.p) || b.p < 0 || b.p > 1) return null;
    if (!isFiniteNumber(b.seed) || b.seed < 0 || b.seed >= nextSeed) return null;
    if (!Array.isArray(b.center) || b.center.length !== 3 || !b.center.every(isFiniteNumber)) return null;
  }
  return value as PaintSnapshot;
}
