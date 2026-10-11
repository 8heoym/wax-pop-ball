// 제스처 상태 기계 (설계 문서 "터치 규칙" 표, Eng review D7, Design review 18A).
// 포인터 이벤트와 시각을 받아 의도(돌리기/누르기/탭/확대/젓기)를 돌려준다. DOM, Three.js와 무관.
//
//  누르기 모드
//  ┌──────┐ down  ┌─────────┐ 10px 넘게 이동   ┌────────┐
//  │ idle │──────▶│ pending │────────────────▶│ rotate │──up──▶ idle
//  └──────┘       └─────────┘                  └────────┘
//     ▲             │   │ 120ms 머묾  ┌───────┐
//     │             │   └───────────▶│ press │──up──▶ idle (자국은 시작점 고정)
//     │             │ 120ms 전 up    └───────┘
//     │             └──────────▶ tap ──▶ idle
//     │   어느 상태든 두 번째 손가락 ──▶ pinch (진행 중 동작 취소, 자국은 남음)
//     │   pinch 중 한 손가락만 남음 ──▶ inert (모두 뗄 때까지 무시)
//     └── 모든 손가락을 뗌
//  세 번째 이후 손가락은 무시. 복원 애니메이션 중(blocked)에는 새 터치를 무시.
//
//  섞기 모드: 공 위에서 시작한 한 손가락 = 젓기. 공 밖에서 시작하면 무시, 두 번째 손가락 무시.

export const MOVE_THRESHOLD_PX = 10;
export const PRESS_DELAY_MS = 120;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;

export type GestureMode = 'mix' | 'press';

export type GestureEvent =
  | { type: 'rotate'; dx: number; dy: number }
  | { type: 'pressStart'; x: number; y: number }
  | { type: 'pressUpdate'; heldSeconds: number }
  | { type: 'pressEnd' }
  | { type: 'pressCancel' }
  | { type: 'tap'; x: number; y: number }
  | { type: 'zoom'; zoom: number }
  | { type: 'stir'; distance: number; x: number; y: number };

type State = 'idle' | 'pending' | 'rotate' | 'press' | 'pinch' | 'inert' | 'stir' | 'ignored';

interface Pointer {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  downAt: number;
}

export interface GestureOptions {
  /** 화면 좌표가 공 실루엣 안인지 (섞기 모드 젓기 판정) */
  isOnBall: (x: number, y: number) => boolean;
  /** 화면 짧은 변(px). 젓기 거리를 짧은 변 = 1로 정규화 */
  shortSide: () => number;
}

export class GestureRecognizer {
  private mode: GestureMode = 'mix';
  private state: State = 'idle';
  /** 손가락 순서대로. 앞의 두 개만 쓰고 나머지는 무시 */
  private pointers: Pointer[] = [];
  private pressStartedAt = 0;
  private zoom = 1;
  private pinchStart = { distance: 1, zoom: 1 };
  private blocked = false;

  constructor(private readonly options: GestureOptions) {}

  getState(): State {
    return this.state;
  }

  getZoom(): number {
    return this.zoom;
  }

  /** 손가락이 하나라도 닿아 있는지 (18A: 닿아 있으면 자동 회전 정지) */
  isTouching(): boolean {
    return this.pointers.length > 0;
  }

  /** 모드 전환은 진행 중 동작을 끝낸다 */
  setMode(mode: GestureMode): GestureEvent[] {
    const events = this.cancelActive();
    this.mode = mode;
    this.pointers = [];
    this.state = 'idle';
    return events;
  }

  /** "다시 동그랗게" 애니메이션 중 터치 무시 (D7) */
  setBlocked(blocked: boolean): GestureEvent[] {
    this.blocked = blocked;
    if (!blocked) return [];
    const events = this.cancelActive();
    this.state = this.pointers.length > 0 ? 'ignored' : 'idle';
    return events;
  }

  pointerDown(id: number, x: number, y: number, now: number): GestureEvent[] {
    if (this.pointers.some((p) => p.id === id)) return [];
    this.pointers.push({ id, startX: x, startY: y, x, y, downAt: now });
    if (this.blocked) {
      this.state = 'ignored';
      return [];
    }
    const count = this.pointers.length;

    if (count === 1) {
      if (this.mode === 'mix') {
        this.state = this.options.isOnBall(x, y) ? 'stir' : 'ignored';
      } else {
        this.state = 'pending';
      }
      return [];
    }

    if (count === 2 && this.mode === 'press' && this.canStartPinch()) {
      const events = this.cancelActive();
      this.state = 'pinch';
      this.pinchStart = { distance: this.pinchDistance(), zoom: this.zoom };
      return events;
    }
    // 섞기 모드의 두 번째 손가락, 세 번째 이후 손가락: 무시
    return [];
  }

  pointerMove(id: number, x: number, y: number, now: number): GestureEvent[] {
    const index = this.pointers.findIndex((p) => p.id === id);
    if (index < 0) return [];
    const pointer = this.pointers[index];
    const prevX = pointer.x;
    const prevY = pointer.y;
    pointer.x = x;
    pointer.y = y;

    switch (this.state) {
      case 'stir': {
        if (index !== 0) return [];
        const distance = Math.hypot(x - prevX, y - prevY) / this.options.shortSide();
        return distance > 0 ? [{ type: 'stir', distance, x, y }] : [];
      }
      case 'pending': {
        if (Math.hypot(x - pointer.startX, y - pointer.startY) > MOVE_THRESHOLD_PX) {
          // 시간 경과로 이미 누르기가 됐어야 하면 이동보다 누르기가 우선
          if (now - pointer.downAt >= PRESS_DELAY_MS) return this.tick(now);
          this.state = 'rotate';
          return [{ type: 'rotate', dx: x - pointer.startX, dy: y - pointer.startY }];
        }
        return this.tick(now);
      }
      case 'rotate':
        return index === 0 ? [{ type: 'rotate', dx: x - prevX, dy: y - prevY }] : [];
      case 'press':
        // 자국은 시작점에 고정: 이동은 무시하고 시간만 반영
        return this.tick(now);
      case 'pinch': {
        if (index > 1) return [];
        const ratio = this.pinchDistance() / this.pinchStart.distance;
        const next = clamp(this.pinchStart.zoom * ratio, ZOOM_MIN, ZOOM_MAX);
        if (next === this.zoom) return [];
        this.zoom = next;
        return [{ type: 'zoom', zoom: next }];
      }
      default:
        return [];
    }
  }

  /** 손가락이 움직이지 않아도 매 프레임 호출 (120ms 머묾 판정, 누르기 깊이 갱신) */
  tick(now: number): GestureEvent[] {
    if (this.state === 'pending') {
      const pointer = this.pointers[0];
      if (now - pointer.downAt < PRESS_DELAY_MS) return [];
      this.state = 'press';
      this.pressStartedAt = pointer.downAt + PRESS_DELAY_MS;
      return [
        { type: 'pressStart', x: pointer.startX, y: pointer.startY },
        { type: 'pressUpdate', heldSeconds: (now - this.pressStartedAt) / 1000 },
      ];
    }
    if (this.state === 'press') {
      return [{ type: 'pressUpdate', heldSeconds: (now - this.pressStartedAt) / 1000 }];
    }
    return [];
  }

  pointerUp(id: number, now: number): GestureEvent[] {
    const index = this.pointers.findIndex((p) => p.id === id);
    if (index < 0) return [];
    const pointer = this.pointers[index];
    const events: GestureEvent[] = [];

    if (index === 0 && this.pointers.length === 1) {
      if (this.state === 'pending') {
        events.push(...this.tick(now));
        if (this.state === 'pending') {
          events.push({ type: 'tap', x: pointer.startX, y: pointer.startY });
        }
      }
      if (this.state === 'press') events.push({ type: 'pressEnd' });
    }

    this.pointers.splice(index, 1);
    if (this.pointers.length === 0) {
      this.state = 'idle';
    } else if (this.state === 'pinch' && index <= 1) {
      // 핀치 중 한 손가락만 남으면 그 손가락을 뗄 때까지 아무 동작도 하지 않음
      this.state = 'inert';
    } else if (this.state === 'stir' && index === 0) {
      this.state = 'ignored';
    }
    return events;
  }

  /** 시스템이 터치를 가로챔(알림, 앱 전환 등). 진행 중 동작을 취소한다 */
  pointerCancel(id: number): GestureEvent[] {
    const index = this.pointers.findIndex((p) => p.id === id);
    if (index < 0) return [];
    const events = index <= 1 ? this.cancelActive() : [];
    this.pointers.splice(index, 1);
    this.state = this.pointers.length === 0 ? 'idle' : 'inert';
    return events;
  }

  private canStartPinch(): boolean {
    return this.state === 'pending' || this.state === 'rotate' || this.state === 'press' || this.state === 'idle';
  }

  private cancelActive(): GestureEvent[] {
    return this.state === 'press' ? [{ type: 'pressCancel' }] : [];
  }

  private pinchDistance(): number {
    const [a, b] = this.pointers;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
