// 점토 메쉬와 누르기 변형 (설계 문서 "누르기 자국 규칙", Eng review D3/D6/D7).
// 변형은 꼭짓점마다 "중심에서의 반지름" 하나로 표현한다. 방향은 원래 구에서 고정이라
// 공이 찌그러져도 마블 노이즈(원래 좌표 기준)가 찢어지지 않고, 저장도 숫자 하나씩이면 된다.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from './paint';

/** 공 반지름. 아래 규칙의 R */
export const CLAY_RADIUS = 1;
/** D3: Icosahedron detail 32 → 삼각형 20×33² = 21,780개 */
export const CLAY_DETAIL = 32;
/** 자국 반경 0.25R, 가장자리로 갈수록 가우시안으로 얕아짐 */
export const DENT_RADIUS = 0.25 * CLAY_RADIUS;
/** 누르고 있는 동안 초당 깊어지는 양 */
export const DENT_RATE = 0.15 * CLAY_RADIUS;
/** 한 번 누를 때 최대 깊이 */
export const DENT_MAX_PER_PRESS = 0.3 * CLAY_RADIUS;
/** 짧은 탭(120ms 전에 뗌) 자국 깊이 (D7) */
export const TAP_DENT_DEPTH = 0.05 * CLAY_RADIUS;
/** 어떤 꼭짓점도 중심에서 이보다 가까워지지 않음 (공이 뚫리거나 뒤집히지 않음) */
export const MIN_RADIUS = 0.55 * CLAY_RADIUS;
/** "다시 동그랗게" 애니메이션 길이 (설계 문서 화면 흐름) */
export const RESTORE_SECONDS = 0.5;

/** 이음매 없는 축구공식 구. UV/법선을 지우고 꼭짓점을 합쳐야 법선 재계산 시 줄이 생기지 않는다 */
export function createClayGeometry(): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(CLAY_RADIUS, CLAY_DETAIL);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

/** 가우시안 감쇠: 중심 1, 자국 반경에서 e^-4 ≈ 0.018, 반경 밖은 0 */
export function dentWeight(distance: number): number {
  if (distance >= DENT_RADIUS) return 0;
  const t = distance / DENT_RADIUS;
  return Math.exp(-4 * t * t);
}

/** 누르는 시간(초) → 이번 누르기의 중심 깊이 */
export function pressDepth(heldSeconds: number): number {
  return Math.min(DENT_MAX_PER_PRESS, Math.max(0, heldSeconds) * DENT_RATE);
}

interface ActivePress {
  indices: Int32Array;
  weights: Float32Array;
  /** 누르기 시작 때 반지름. 깊이는 여기서부터 계산해 프레임마다 누적되지 않게 한다 */
  baseRadii: Float32Array;
}

export class ClayDeformer {
  /** 원래 구 위의 단위 방향 (x, y, z 반복) */
  readonly directions: Float32Array;
  /** 꼭짓점별 현재 반지름 */
  readonly radii: Float32Array;
  private press: ActivePress | null = null;
  private restoreFrom: Float32Array | null = null;

  constructor(originalPositions: ArrayLike<number>) {
    const count = originalPositions.length / 3;
    this.directions = new Float32Array(originalPositions.length);
    this.radii = new Float32Array(count).fill(CLAY_RADIUS);
    for (let i = 0; i < count; i++) {
      const x = originalPositions[i * 3];
      const y = originalPositions[i * 3 + 1];
      const z = originalPositions[i * 3 + 2];
      const len = Math.hypot(x, y, z);
      this.directions[i * 3] = x / len;
      this.directions[i * 3 + 1] = y / len;
      this.directions[i * 3 + 2] = z / len;
    }
  }

  get vertexCount(): number {
    return this.radii.length;
  }

  /**
   * 누르기 시작. point는 손가락이 닿은 곳을 공의 원래 좌표로 바꾼 방향 (자국은 시작점에 고정, D7).
   * 원래 구 위에서의 거리로 영향 범위를 정하므로 이미 파인 곳을 다시 눌러도 자국 크기가 같다.
   */
  beginPress(point: Vec3): void {
    this.cancelRestore();
    const len = Math.hypot(point[0], point[1], point[2]);
    const px = (point[0] / len) * CLAY_RADIUS;
    const py = (point[1] / len) * CLAY_RADIUS;
    const pz = (point[2] / len) * CLAY_RADIUS;
    const indices: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < this.vertexCount; i++) {
      const dx = this.directions[i * 3] * CLAY_RADIUS - px;
      const dy = this.directions[i * 3 + 1] * CLAY_RADIUS - py;
      const dz = this.directions[i * 3 + 2] * CLAY_RADIUS - pz;
      const w = dentWeight(Math.hypot(dx, dy, dz));
      if (w > 0) {
        indices.push(i);
        weights.push(w);
      }
    }
    const indexArray = Int32Array.from(indices);
    this.press = {
      indices: indexArray,
      weights: Float32Array.from(weights),
      baseRadii: Float32Array.from(indexArray, (i) => this.radii[i]),
    };
  }

  /** 누르고 있는 동안 매 프레임 호출. 변형된 꼭짓점이 있으면 true (법선 재계산 필요) */
  updatePress(heldSeconds: number): boolean {
    return this.applyDepth(pressDepth(heldSeconds));
  }

  endPress(): void {
    this.press = null;
  }

  /** 짧은 탭: 작은 자국 하나 */
  tap(point: Vec3): void {
    this.beginPress(point);
    this.applyDepth(TAP_DENT_DEPTH);
    this.endPress();
  }

  /** 두 번째 손가락 등으로 누르기가 취소돼도 이미 생긴 자국은 남는다 (설계 문서 제스처 표) */
  cancelPress(): void {
    this.endPress();
  }

  private applyDepth(depth: number): boolean {
    if (!this.press) return false;
    const { indices, weights, baseRadii } = this.press;
    for (let k = 0; k < indices.length; k++) {
      const r = baseRadii[k] - depth * weights[k];
      this.radii[indices[k]] = Math.min(CLAY_RADIUS, Math.max(MIN_RADIUS, r));
    }
    return indices.length > 0;
  }

  /** 새 점토: 즉시 원래 구로 (애니메이션 없음) */
  reset(): void {
    this.endPress();
    this.restoreFrom = null;
    this.radii.fill(CLAY_RADIUS);
  }

  isDented(): boolean {
    return this.radii.some((r) => r !== CLAY_RADIUS);
  }

  /** "다시 동그랗게" 시작: 지금 모양에서 원래 구로 0.5초 동안 돌아간다 */
  beginRestore(): void {
    this.endPress();
    this.restoreFrom = Float32Array.from(this.radii);
  }

  isRestoring(): boolean {
    return this.restoreFrom !== null;
  }

  /** 복원 애니메이션 진행. 끝나면 정확히 원래 반지름이 되고 false 반환 */
  updateRestore(elapsedSeconds: number): boolean {
    if (!this.restoreFrom) return false;
    const t = Math.min(1, Math.max(0, elapsedSeconds / RESTORE_SECONDS));
    const eased = 1 - (1 - t) ** 3;
    for (let i = 0; i < this.vertexCount; i++) {
      this.radii[i] = this.restoreFrom[i] + (CLAY_RADIUS - this.restoreFrom[i]) * eased;
    }
    if (t >= 1) {
      this.radii.fill(CLAY_RADIUS);
      this.restoreFrom = null;
      return false;
    }
    return true;
  }

  private cancelRestore(): void {
    // 복원 중에는 터치를 무시하므로(D7) 보통 오지 않지만, 오면 지금 모양에서 멈춘다
    this.restoreFrom = null;
  }

  /** 현재 모양을 BufferGeometry position 배열에 쓴다 */
  writePositions(target: Float32Array): void {
    for (let i = 0; i < this.vertexCount; i++) {
      const r = this.radii[i];
      target[i * 3] = this.directions[i * 3] * r;
      target[i * 3 + 1] = this.directions[i * 3 + 1] * r;
      target[i * 3 + 2] = this.directions[i * 3 + 2] * r;
    }
  }

  /** 저장용: 꼭짓점 반지름을 base64(Float32)로 */
  serializeRadii(): string {
    const bytes = new Uint8Array(this.radii.buffer, this.radii.byteOffset, this.radii.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  /** 저장된 반지름 복원. 꼭짓점 수가 다르거나 값이 이상하면 false (D6: 버리고 새 점토) */
  restoreRadii(encoded: unknown): boolean {
    if (typeof encoded !== 'string') return false;
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      return false;
    }
    if (binary.length !== this.radii.byteLength) return false;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const values = new Float32Array(bytes.buffer);
    for (const r of values) {
      if (!Number.isFinite(r) || r < MIN_RADIUS || r > CLAY_RADIUS) return false;
    }
    this.endPress();
    this.restoreFrom = null;
    this.radii.set(values);
    return true;
  }
}
