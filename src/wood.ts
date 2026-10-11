// 나무 공방 책상 (Design review 12A). 이미지 파일 없이 시작할 때 노이즈로 나뭇결을 그린다.
// 줄무늬 그라데이션 대신 노이즈로 흔들린 결이라 반복 무늬가 보이지 않는다.
import { createNoise3 } from './noise';

const LIGHT: [number, number, number] = [233, 207, 166]; // --color-wood
const DARK: [number, number, number] = [201, 165, 116]; // --color-wood-dark

/** 나뭇결 이미지를 data URL로 만든다. size는 타일 한 변(px) */
export function createWoodTexture(size = 512): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(size, size);
  const grain = createNoise3(42);
  const fine = createNoise3(43);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 가로로 길게 흐르는 결: x는 느리게, y는 빠르게 변하는 노이즈 + 고리 모양 흔들림
      // 양 끝이 이어지도록 x를 원 위의 좌표로 바꿔 노이즈를 읽는다 (타일 반복 시 이음매 없음)
      const angle = (x / size) * Math.PI * 2;
      const u = Math.cos(angle) * 0.8;
      const w = Math.sin(angle) * 0.8;
      const v = (y / size) * Math.PI * 2;
      // 결은 완만하게 흔들리고 명암 차이는 작게: 공과 튜브보다 눈에 띄지 않도록
      const wobble = grain(u * 0.6, Math.cos(v) * 0.4, w * 0.6 + Math.sin(v) * 0.4) * 0.9;
      const ring = Math.sin(v * 7 + wobble * 2.4);
      const streak = fine(u * 4, Math.cos(v) * 18, w * 4 + Math.sin(v) * 18) * 0.5;
      const t = Math.min(1, Math.max(0, 0.3 + 0.1 * ring + 0.12 * streak));
      const i = (y * size + x) * 4;
      image.data[i] = LIGHT[0] + (DARK[0] - LIGHT[0]) * t;
      image.data[i + 1] = LIGHT[1] + (DARK[1] - LIGHT[1]) * t;
      image.data[i + 2] = LIGHT[2] + (DARK[2] - LIGHT[2]) * t;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 공 아래 접지 그림자 (부드러운 타원) 텍스처 */
export function createShadowCanvas(size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(91, 60, 28, 0.45)');
    gradient.addColorStop(0.55, 'rgba(91, 60, 28, 0.18)');
    gradient.addColorStop(1, 'rgba(91, 60, 28, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}
