import { describe, expect, it } from 'vitest';
import { SoundBoard, squishFrequency, stirGain } from '../src/audio';

describe('소리 파라미터 (8A)', () => {
  it('많이 짤수록 찌익 소리가 낮아진다', () => {
    expect(squishFrequency(0.25)).toBe(520);
    expect(squishFrequency(3)).toBe(220);
    expect(squishFrequency(1)).toBeLessThan(squishFrequency(0.5));
    expect(squishFrequency(10)).toBe(220);
  });

  it('빨리 저을수록 크지만 0.35를 넘지 않고, 멈추면 0', () => {
    expect(stirGain(0)).toBe(0);
    expect(stirGain(0.5)).toBeCloseTo(0.125);
    expect(stirGain(100)).toBe(0.35);
    expect(stirGain(-1)).toBe(0);
  });
});

describe('소리 장치', () => {
  it('첫 터치 전(AudioContext 없음)에는 어떤 호출도 조용히 무시', () => {
    const sound = new SoundBoard(false);
    expect(() => {
      sound.squishStart(1);
      sound.squishUpdate(2);
      sound.squishStop();
      sound.stirUpdate(1);
      sound.pop();
      sound.tong();
      sound.chime(true);
      sound.setMuted(true);
    }).not.toThrow();
    expect(sound.isMuted()).toBe(true);
  });
});
