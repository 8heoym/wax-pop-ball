// 설계 문서 "제스처 상태" 표를 그대로 옮긴 테스트. 행 하나 = 시나리오 하나.
import { describe, expect, it } from 'vitest';
import {
  GestureRecognizer,
  MOVE_THRESHOLD_PX,
  PRESS_DELAY_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  type GestureEvent,
  type GestureMode,
} from '../src/gestures';

const SHORT_SIDE = 800;

/** 공은 화면 (400, 400) 중심 반지름 200 원 */
function makeRecognizer(mode: GestureMode = 'press'): GestureRecognizer {
  const g = new GestureRecognizer({
    isOnBall: (x, y) => Math.hypot(x - 400, y - 400) <= 200,
    shortSide: () => SHORT_SIDE,
  });
  g.setMode(mode);
  return g;
}

type Step =
  | ['down', number, number, number, number] // id, x, y, t
  | ['move', number, number, number, number]
  | ['up', number, number] // id, t
  | ['cancel', number]
  | ['tick', number]
  | ['block', boolean];

function run(g: GestureRecognizer, steps: Step[]): GestureEvent[] {
  const events: GestureEvent[] = [];
  for (const step of steps) {
    switch (step[0]) {
      case 'down':
        events.push(...g.pointerDown(step[1], step[2], step[3], step[4]));
        break;
      case 'move':
        events.push(...g.pointerMove(step[1], step[2], step[3], step[4]));
        break;
      case 'up':
        events.push(...g.pointerUp(step[1], step[2]));
        break;
      case 'cancel':
        events.push(...g.pointerCancel(step[1]));
        break;
      case 'tick':
        events.push(...g.tick(step[1]));
        break;
      case 'block':
        events.push(...g.setBlocked(step[1]));
        break;
    }
  }
  return events;
}

const types = (events: GestureEvent[]) => events.map((e) => e.type);
const JUST_UNDER = MOVE_THRESHOLD_PX - 1;
const JUST_OVER = MOVE_THRESHOLD_PX + 1;

describe('누르기 모드: 상태 표', () => {
  it.each<[string, Step[], string[], string]>([
    ['짧은 탭 (120ms 전에 뗌) → 탭', [['down', 1, 400, 400, 0], ['up', 1, 80]], ['tap'], 'idle'],
    [
      '10px 이내로 움직였다 120ms 전에 떼면 여전히 탭',
      [['down', 1, 400, 400, 0], ['move', 1, 400 + JUST_UNDER, 400, 50], ['up', 1, 90]],
      ['tap'],
      'idle',
    ],
    [
      '10px 넘게 움직이면 돌리기',
      [['down', 1, 400, 400, 0], ['move', 1, 400 + JUST_OVER, 400, 30]],
      ['rotate'],
      'rotate',
    ],
    [
      '120ms 머물면 누르기 시작',
      [['down', 1, 400, 400, 0], ['tick', PRESS_DELAY_MS]],
      ['pressStart', 'pressUpdate'],
      'press',
    ],
    [
      '누르기 중 손가락을 떼면 누르기 끝',
      [['down', 1, 400, 400, 0], ['tick', 200], ['up', 1, 500]],
      ['pressStart', 'pressUpdate', 'pressEnd'],
      'idle',
    ],
    [
      'tick 없이 120ms 뒤에 떼도 누르기로 처리',
      [['down', 1, 400, 400, 0], ['up', 1, 300]],
      ['pressStart', 'pressUpdate', 'pressEnd'],
      'idle',
    ],
    [
      '누르기 중 크게 움직여도 돌리기로 바뀌지 않음 (자국 고정)',
      [['down', 1, 400, 400, 0], ['tick', 150], ['move', 1, 600, 400, 200]],
      ['pressStart', 'pressUpdate', 'pressUpdate'],
      'press',
    ],
    [
      '120ms 지난 뒤 처음 움직임이 10px를 넘어도 누르기가 우선',
      [['down', 1, 400, 400, 0], ['move', 1, 450, 400, 200]],
      ['pressStart', 'pressUpdate'],
      'press',
    ],
    [
      '대기 중 두 번째 손가락 → 확대 (탭 없음)',
      [['down', 1, 400, 400, 0], ['down', 2, 500, 400, 20], ['up', 1, 60], ['up', 2, 70]],
      [],
      'idle',
    ],
    [
      '누르기 중 두 번째 손가락 → 누르기 취소 후 확대',
      [['down', 1, 400, 400, 0], ['tick', 200], ['down', 2, 500, 400, 300]],
      ['pressStart', 'pressUpdate', 'pressCancel'],
      'pinch',
    ],
    [
      '돌리기 중 두 번째 손가락 → 확대',
      [['down', 1, 400, 400, 0], ['move', 1, 430, 400, 20], ['down', 2, 500, 400, 40]],
      ['rotate'],
      'pinch',
    ],
    [
      '확대 중 한 손가락만 남으면 무시 상태',
      [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10], ['up', 1, 100]],
      [],
      'inert',
    ],
    [
      '무시 상태의 남은 손가락은 움직이거나 오래 있어도 아무 동작 없음',
      [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10], ['up', 1, 100], ['move', 2, 700, 400, 200], ['tick', 900]],
      [],
      'inert',
    ],
    [
      '무시 상태 손가락을 떼면 다시 대기',
      [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10], ['up', 1, 100], ['up', 2, 200]],
      [],
      'idle',
    ],
    [
      '세 번째 손가락은 무시',
      [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10], ['down', 3, 600, 600, 20], ['move', 3, 100, 100, 30]],
      [],
      'pinch',
    ],
    [
      '시스템 취소 시 누르기 취소',
      [['down', 1, 400, 400, 0], ['tick', 200], ['cancel', 1]],
      ['pressStart', 'pressUpdate', 'pressCancel'],
      'idle',
    ],
  ])('%s', (_name, steps, expected, finalState) => {
    const g = makeRecognizer('press');
    expect(types(run(g, steps))).toEqual(expected);
    expect(g.getState()).toBe(finalState);
  });

  it('탭과 누르기 좌표는 손가락이 처음 닿은 곳', () => {
    const tap = run(makeRecognizer(), [['down', 1, 123, 456, 0], ['move', 1, 128, 456, 30], ['up', 1, 60]]);
    expect(tap).toEqual([{ type: 'tap', x: 123, y: 456 }]);
    const press = run(makeRecognizer(), [['down', 1, 123, 456, 0], ['tick', 150], ['move', 1, 300, 300, 200]]);
    expect(press[0]).toEqual({ type: 'pressStart', x: 123, y: 456 });
  });

  it('누르기 시간은 누르기가 시작된 때(닿은 뒤 120ms)부터 잰다', () => {
    const events = run(makeRecognizer(), [['down', 1, 400, 400, 0], ['tick', 120], ['tick', 1120]]);
    const held = events.filter((e) => e.type === 'pressUpdate').map((e) => (e as { heldSeconds: number }).heldSeconds);
    expect(held[0]).toBeCloseTo(0);
    expect(held[1]).toBeCloseTo(1);
  });

  it('돌리기는 직전 위치와의 차이를 보낸다', () => {
    const events = run(makeRecognizer(), [
      ['down', 1, 400, 400, 0],
      ['move', 1, 420, 400, 10],
      ['move', 1, 430, 410, 20],
    ]);
    expect(events).toEqual([
      { type: 'rotate', dx: 20, dy: 0 },
      { type: 'rotate', dx: 10, dy: 10 },
    ]);
  });
});

describe('확대/축소 (0.6~2배)', () => {
  it('두 손가락 거리 비율대로 확대하고 한계에서 멈춘다', () => {
    const g = makeRecognizer();
    run(g, [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10]]); // 거리 200
    run(g, [['move', 2, 600, 400, 20]]); // 300 → 1.5배
    expect(g.getZoom()).toBeCloseTo(1.5);
    run(g, [['move', 2, 1500, 400, 30]]);
    expect(g.getZoom()).toBe(ZOOM_MAX);
    run(g, [['move', 2, 310, 400, 40]]);
    expect(g.getZoom()).toBe(ZOOM_MIN);
  });

  it('다음 핀치는 이전 확대 배율에서 이어진다', () => {
    const g = makeRecognizer();
    run(g, [['down', 1, 300, 400, 0], ['down', 2, 500, 400, 10], ['move', 2, 600, 400, 20], ['up', 1, 30], ['up', 2, 40]]);
    // 두 번째 핀치: 거리 200 → 100 (0.5배). 1.5에서 이어지면 0.75, 1에서 새로 시작하면 0.6으로 잘림
    run(g, [['down', 1, 300, 400, 100], ['down', 2, 500, 400, 110], ['move', 2, 400, 400, 120]]);
    expect(g.getZoom()).toBeCloseTo(0.75);
  });
});

describe('다시 동그랗게 애니메이션 중 (blocked)', () => {
  it('새 터치를 무시하고, 해제 후 손가락을 다시 대면 정상', () => {
    const g = makeRecognizer();
    expect(run(g, [['block', true], ['down', 1, 400, 400, 0], ['tick', 500], ['up', 1, 600]])).toEqual([]);
    run(g, [['block', false]]);
    expect(types(run(g, [['down', 1, 400, 400, 1000], ['up', 1, 1050]]))).toEqual(['tap']);
  });

  it('누르는 중에 막히면 누르기 취소, 그 손가락은 뗄 때까지 무시', () => {
    const g = makeRecognizer();
    const events = run(g, [['down', 1, 400, 400, 0], ['tick', 200], ['block', true], ['block', false], ['tick', 400], ['up', 1, 500]]);
    expect(types(events)).toEqual(['pressStart', 'pressUpdate', 'pressCancel']);
    expect(g.getState()).toBe('idle');
  });
});

describe('섞기 모드', () => {
  it('공 위에서 시작한 문지르기 = 젓기, 거리는 화면 짧은 변 기준', () => {
    const g = makeRecognizer('mix');
    const events = run(g, [['down', 1, 400, 400, 0], ['move', 1, 480, 400, 10], ['move', 1, 480, 460, 20]]);
    expect(events).toEqual([
      { type: 'stir', distance: 80 / SHORT_SIDE, x: 480, y: 400 },
      { type: 'stir', distance: 60 / SHORT_SIDE, x: 480, y: 460 },
    ]);
  });

  it('공 밖에서 시작하면 공 안으로 들어와도 젓기가 아니다 (18A)', () => {
    const g = makeRecognizer('mix');
    expect(run(g, [['down', 1, 50, 50, 0], ['move', 1, 400, 400, 10], ['move', 1, 450, 400, 20]])).toEqual([]);
  });

  it('두 번째 손가락은 무시하고, 첫 손가락을 떼면 남은 손가락도 젓지 않는다', () => {
    const g = makeRecognizer('mix');
    const events = run(g, [
      ['down', 1, 400, 400, 0],
      ['down', 2, 420, 420, 5],
      ['move', 2, 500, 500, 10],
      ['up', 1, 20],
      ['move', 2, 400, 400, 30],
    ]);
    expect(events).toEqual([]);
    expect(g.getState()).toBe('ignored');
  });

  it('섞기 모드에서는 탭/누르기/확대가 없다', () => {
    const g = makeRecognizer('mix');
    expect(run(g, [['down', 1, 400, 400, 0], ['tick', 500], ['down', 2, 300, 300, 600], ['up', 1, 700], ['up', 2, 800]])).toEqual([]);
  });

  it('손가락이 닿아 있는 동안만 isTouching (자동 회전 정지용)', () => {
    const g = makeRecognizer('mix');
    expect(g.isTouching()).toBe(false);
    run(g, [['down', 1, 400, 400, 0]]);
    expect(g.isTouching()).toBe(true);
    run(g, [['up', 1, 100]]);
    expect(g.isTouching()).toBe(false);
  });
});

describe('모드 전환', () => {
  it('누르는 중 모드를 바꾸면 누르기 취소 후 대기', () => {
    const g = makeRecognizer('press');
    run(g, [['down', 1, 400, 400, 0], ['tick', 200]]);
    expect(types(g.setMode('mix'))).toEqual(['pressCancel']);
    expect(g.getState()).toBe('idle');
  });
});
