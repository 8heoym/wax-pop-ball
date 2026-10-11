// 소리 6종 (Design review 8A, Eng re-review R12). 소리 파일 없이 Web Audio로 합성해
// 오프라인 캐시와 용량 걱정이 없다.
//  짜기 '찌익'(양에 따라 음높이) · 젓기 문지르는 소리(속도에 따라 볼륨) · 누르기 '뽁'
//  · 다시 동그랗게 '통' · 다 섞임/완성 작은 종소리
// Safari는 첫 터치 전에는 소리를 낼 수 없어 unlock()을 첫 pointerdown에서 부른다.

/** 짜는 양 0.25~3 → '찌익' 음높이(Hz). 많이 짤수록 낮고 묵직하게 */
export function squishFrequency(amount: number): number {
  const t = Math.min(1, Math.max(0, (amount - 0.25) / 2.75));
  return 520 - t * 300;
}

/** 젓는 속도(화면 짧은 변/초) → 문지르는 소리 볼륨 0~0.35 */
export function stirGain(speed: number): number {
  return Math.min(0.35, Math.max(0, speed * 0.25));
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export class SoundBoard {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private stirSource: AudioBufferSourceNode | null = null;
  private stirGainNode: GainNode | null = null;
  private squish: { osc: OscillatorNode; gain: GainNode } | null = null;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.02);
    }
  }

  /** 첫 터치에서 호출. 지원하지 않는 브라우저면 조용히 무음 */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    // R12: 무음 설정과 다른 앱 음악을 존중 (iOS 기본값이지만 명시)
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = 'ambient';
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.context.destination);
    this.noise = this.makeNoise();
    void this.context.resume();
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // 결정적 갈색 잡음 (점토를 문지르는 낮은 소리)
    let last = 0;
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const white = (seed / 0x7fffffff) * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  }

  private ready(): AudioContext | null {
    return this.context && this.master ? this.context : null;
  }

  /** 짜기 시작: 양에 따라 내려가는 '찌익' */
  squishStart(amount: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.squishStop();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = squishFrequency(amount);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.03);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start();
    this.squish = { osc, gain };
  }

  squishUpdate(amount: number): void {
    const ctx = this.ready();
    if (!ctx || !this.squish) return;
    this.squish.osc.frequency.setTargetAtTime(squishFrequency(amount), ctx.currentTime, 0.05);
  }

  squishStop(): void {
    const ctx = this.ready();
    if (!ctx || !this.squish) return;
    const { osc, gain } = this.squish;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    osc.stop(ctx.currentTime + 0.2);
    this.squish = null;
  }

  /** 젓는 동안 매 프레임: 속도에 따라 볼륨. 0이면 서서히 꺼진다 */
  stirUpdate(speed: number): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    if (!this.stirSource) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master!);
      source.start();
      this.stirSource = source;
      this.stirGainNode = gain;
    }
    this.stirGainNode!.gain.setTargetAtTime(stirGain(speed), ctx.currentTime, 0.08);
  }

  /** 누르기 '뽁' */
  pop(): void {
    this.blip(260, 120, 0.12, 0.25, 'sine');
  }

  /** 다시 동그랗게 '통' */
  tong(): void {
    this.blip(180, 150, 0.35, 0.3, 'triangle');
  }

  /** 다 섞임/완성 종소리 */
  chime(big = false): void {
    const notes = big ? [784, 988, 1175] : [988, 1319];
    notes.forEach((frequency, i) => this.blip(frequency, frequency, 0.6, 0.12, 'sine', i * 0.09));
  }

  private blip(from: number, to: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
}
