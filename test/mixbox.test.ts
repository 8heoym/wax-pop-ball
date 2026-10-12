// Eng review D4 전제와 성공 기준 확인:
// - 덩어리 색을 CPU에서 latent로 바꾸고, 셰이더는 LUT 없이 latent → RGB만 계산한다.
// - 각 물감 양 2 + 흰 점토 양 1을 완전히 섞으면 회색이 아닌 또렷한 색이 된다.
// 튜브 색이나 Mixbox 버전이 바뀌어 이 전제가 깨지면 여기서 잡힌다.
import { describe, expect, it } from 'vitest';
import mixbox from 'mixbox';
import { CLAY_WHITE, TUBES, TUBE_GROUPS, type Rgb, type TubeId } from '../src/palette';

function mixByAmount(parts: Array<[Rgb, number]>): number[] {
  const total = parts.reduce((sum, [, amount]) => sum + amount, 0);
  const latent = new Array<number>(mixbox.LATENT_SIZE).fill(0);
  for (const [rgb, amount] of parts) {
    const z = mixbox.rgbToLatent(rgb[0], rgb[1], rgb[2]);
    z.forEach((v, k) => (latent[k] += (amount / total) * v));
  }
  return Array.from(mixbox.latentToRgb(latent)).slice(0, 3);
}

/** HSV 색상각 0~360 */
function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

type HueCheck = (r: number, g: number, b: number) => boolean;

describe('Mixbox 물감 혼합 (D4, 성공 기준)', () => {
  it.each<[string, Rgb, Rgb, HueCheck]>([
    ['파랑+노랑 = 초록', TUBES.blue, TUBES.yellow, (r, g, b) => g > r && g > b],
    ['빨강+노랑 = 주황', TUBES.red, TUBES.yellow, (r, g, b) => r > g && g > b],
    ['빨강+파랑 = 보라', TUBES.red, TUBES.blue, (r, g, b) => r > g && b > g],
  ])('%s (각 양 2 + 흰 점토 양 1)', (_name, a, b, hueCheck) => {
    const [r, g, bl] = mixByAmount([
      [a, 2],
      [b, 2],
      [CLAY_WHITE, 1],
    ]);
    expect(hueCheck(r, g, bl)).toBe(true);
    // 채도: 최대-최소 차이가 충분해야 회색이 아님
    expect(Math.max(r, g, bl) - Math.min(r, g, bl)).toBeGreaterThan(60);
  });

  // 고른 색 = 나오는 색: 튜브 하나(양 3)를 흰 점토(양 1)와 다 섞어도 같은 색 계열(색상각 20도 이내)이어야
  // 아이가 "민트를 골랐는데 왜 이 색이야?"가 되지 않는다. 무채색(흰, 검정)은 제외
  const chromatic = (Object.keys(TUBES) as TubeId[]).filter((id) => id !== 'white' && id !== 'black');
  it.each(chromatic)('%s 튜브는 흰 점토와 섞여도 같은 색 계열', (id) => {
    const [r, g, b] = mixByAmount([
      [TUBES[id], 3],
      [CLAY_WHITE, 1],
    ]);
    const diff = Math.abs(hue(r, g, b) - hue(TUBES[id][0], TUBES[id][1], TUBES[id][2]));
    expect(Math.min(diff, 360 - diff)).toBeLessThan(20);
  });

  it('GLSL latent → RGB 변환은 LUT 텍스처를 쓰지 않는다', () => {
    const source = mixbox.glsl();
    const start = source.indexOf('vec3 mixbox_latent_to_rgb(');
    const end = source.indexOf('\n}', start);
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, end)).not.toMatch(/texture/);
  });
});

describe('물감 묶음 (기본/파스텔/진한색)', () => {
  it('모든 튜브가 정확히 한 묶음에 들어 있고, 묶음마다 6개', () => {
    const grouped = TUBE_GROUPS.flatMap((g) => g.tubes);
    expect([...grouped].sort()).toEqual(Object.keys(TUBES).sort());
    for (const group of TUBE_GROUPS) expect(group.tubes).toHaveLength(6);
  });
});
