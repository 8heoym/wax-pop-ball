// 물감 튜브 색 (sRGB 0~255). 튜브 서랍 순서대로 (Design review 15A).
// 빨강은 주황빛 카드뮴 레드 대신 푸른 기운의 스칼렛, 파랑은 밝은 파랑을 쓴다.
// 카드뮴 레드 + 코발트 블루는 Mixbox에서 rgb(85,47,58)처럼 탁한 자주가 되어
// 성공 기준(빨강+파랑 = 또렷한 보라)을 못 맞춘다. test/mixbox.test.ts 참고.
export type Rgb = readonly [number, number, number];

export const TUBES = {
  white: [255, 255, 255],
  red: [255, 35, 59],
  pink: [255, 105, 180],
  yellow: [252, 211, 0],
  blue: [30, 90, 230],
  black: [24, 22, 26],
} as const satisfies Record<string, Rgb>;

export type TubeId = keyof typeof TUBES;

export const TUBE_ORDER: readonly TubeId[] = ['white', 'red', 'pink', 'yellow', 'blue', 'black'];

// 흰 점토 바탕 (덩어리 목록의 첫 항목, 양 1)
export const CLAY_WHITE: Rgb = [250, 248, 244];
