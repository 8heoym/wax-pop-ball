// mixbox 2.0.0은 타입 정의를 제공하지 않는다. 이 앱이 쓰는 함수만 선언.
declare module 'mixbox' {
  type Latent = number[];
  type Rgb = number[];
  const mixbox: {
    LATENT_SIZE: number;
    rgbToLatent(r: number, g: number, b: number): Latent;
    latentToRgb(latent: Latent): Rgb;
    lerp(color1: Rgb | string, color2: Rgb | string, t: number): Rgb;
    glsl(): string;
  };
  export default mixbox;
}
