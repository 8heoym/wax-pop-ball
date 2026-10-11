// Eng review D4 전제와 성공 기준 확인:
// - 덩어리 색을 CPU에서 latent로 바꾸고, 셰이더는 LUT 없이 latent → RGB만 계산한다.
// - 각 물감 양 2 + 흰 점토 양 1을 완전히 섞으면 회색이 아닌 또렷한 색이 된다.
// 튜브 색이나 Mixbox 버전이 바뀌어 이 전제가 깨지면 여기서 잡힌다.
import { describe, expect, it } from 'vitest';
import mixbox from 'mixbox';
import { CLAY_WHITE, TUBES, type Rgb } from '../src/palette';

function mixByAmount(parts: Array<[Rgb, number]>): number[] {
  const total = parts.reduce((sum, [, amount]) => sum + amount, 0);
  const latent = new Array<number>(mixbox.LATENT_SIZE).fill(0);
  for (const [rgb, amount] of parts) {
    const z = mixbox.rgbToLatent(rgb[0], rgb[1], rgb[2]);
    z.forEach((v, k) => (latent[k] += (amount / total) * v));
  }
  return Array.from(mixbox.latentToRgb(latent)).slice(0, 3);
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

  it('GLSL latent → RGB 변환은 LUT 텍스처를 쓰지 않는다', () => {
    const source = mixbox.glsl();
    const start = source.indexOf('vec3 mixbox_latent_to_rgb(');
    const end = source.indexOf('\n}', start);
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, end)).not.toMatch(/texture/);
  });
});
