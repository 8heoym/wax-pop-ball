// 물감 튜브 색 (sRGB 0~255). 서랍은 묶음(기본/파스텔/진한) 탭으로 나눠 한 번에 6개씩 보인다.
// 빨강은 주황빛 카드뮴 레드 대신 푸른 기운의 스칼렛, 파랑은 밝은 파랑을 쓴다.
// 카드뮴 레드 + 코발트 블루는 Mixbox에서 rgb(85,47,58)처럼 탁한 자주가 되어
// 성공 기준(빨강+파랑 = 또렷한 보라)을 못 맞춘다. test/mixbox.test.ts 참고.
// 파스텔·진한 색은 흰 점토와 섞여도 같은 색 계열로 남는지 test/mixbox.test.ts에서 확인한다.
// 저장된 작품이 튜브 id를 쓰므로 id는 바꾸거나 지우지 말 것 (persist 검증).
export type Rgb = readonly [number, number, number];

export const TUBES = {
  white: [255, 255, 255],
  red: [255, 35, 59],
  pink: [255, 105, 180],
  yellow: [252, 211, 0],
  blue: [30, 90, 230],
  black: [24, 22, 26],
  strawberryMilk: [255, 170, 190],
  peach: [255, 190, 150],
  bananaMilk: [255, 230, 140],
  mint: [120, 225, 195],
  sky: [130, 200, 245],
  lavender: [190, 165, 240],
  orange: [255, 130, 20],
  green: [40, 175, 70],
  teal: [0, 150, 160],
  purple: [130, 50, 190],
  brown: [110, 65, 40],
  navy: [30, 40, 110],
} as const satisfies Record<string, Rgb>;

export type TubeId = keyof typeof TUBES;

/** 튜브에 적히는 이름. 3·4학년이 색상환이 아니라 이름과 느낌으로 고르도록 */
export const TUBE_NAMES: Record<TubeId, string> = {
  white: '흰색',
  red: '빨강',
  pink: '분홍',
  yellow: '노랑',
  blue: '파랑',
  black: '검정',
  strawberryMilk: '딸기우유',
  peach: '복숭아',
  bananaMilk: '바나나우유',
  mint: '민트',
  sky: '하늘',
  lavender: '라벤더',
  orange: '귤',
  green: '풀잎',
  teal: '바다',
  purple: '포도',
  brown: '초코',
  navy: '밤하늘',
};

export interface TubeGroup {
  readonly id: 'basic' | 'pastel' | 'deep';
  readonly name: string;
  readonly tubes: readonly TubeId[];
}

export const TUBE_GROUPS: readonly TubeGroup[] = [
  { id: 'basic', name: '기본', tubes: ['white', 'red', 'pink', 'yellow', 'blue', 'black'] },
  { id: 'pastel', name: '파스텔', tubes: ['strawberryMilk', 'peach', 'bananaMilk', 'mint', 'sky', 'lavender'] },
  { id: 'deep', name: '진한색', tubes: ['orange', 'green', 'teal', 'purple', 'brown', 'navy'] },
];

// 흰 점토 바탕 (덩어리 목록의 첫 항목, 양 1)
export const CLAY_WHITE: Rgb = [250, 248, 244];
