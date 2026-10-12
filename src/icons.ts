// 두툼한 둥근 아이콘 (Design review 12A: 선 굵기 3px 이상, 이모지 금지). currentColor 사용.
import type { TubeId } from './palette';

const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  gear: svg(
    '<circle cx="24" cy="24" r="6"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>',
  ),
  brush: svg('<path d="M30 8l10 10-14 14-10-10z"/><path d="M16 22c-6 0-8 6-8 10 0 3-2 5-2 5s8 2 12-2c3-3 2-7 2-7"/>'),
  soundOn: svg('<path d="M8 19h7l9-8v26l-9-8H8z"/><path d="M31 18c2 2 2 10 0 12M36 13c5 5 5 17 0 22"/>'),
  soundOff: svg('<path d="M8 19h7l9-8v26l-9-8H8z"/><path d="M32 19l10 10M42 19L32 29"/>'),
  check: svg('<path d="M11 25l9 9 17-19"/>'),
  undo: svg('<path d="M14 18h16a10 10 0 010 20H18"/><path d="M20 11l-7 7 7 7"/>'),
  // 공 둘레를 도는 두 화살표: 원래 모양으로 되돌리기
  roundAgain: svg('<circle cx="24" cy="24" r="8"/><path d="M38 20a15 15 0 00-26.5-6M10 28a15 15 0 0026.5 6"/><path d="M11 7v7h7M37 41v-7h-7"/>'),
  // 새 흰 점토 덩어리 + 반짝
  newClay: svg('<circle cx="22" cy="28" r="12"/><path d="M38 6v8M34 10h8"/>'),
} as const;

/** 둥근 기본 뚜껑. 파스텔·진한 튜브는 이름이 적혀 있어 모양으로 구분하지 않는다 */
export const DEFAULT_CAP = '<rect x="11" y="8" width="26" height="32" rx="9"/>';

/** 색약 대비 기본 튜브 뚜껑 모양 (Design review 15A) */
export const CAP_SHAPES: Partial<Record<TubeId, string>> = {
  white: '<path d="M24 6l14 18-14 18-14-18z"/>',
  red: '<circle cx="24" cy="24" r="16"/>',
  pink: '<path d="M24 40C10 30 6 22 10 15c4-6 11-5 14 1 3-6 10-7 14-1 4 7 0 15-14 25z"/>',
  yellow: '<path d="M24 5l5.6 12.4 13.4 1.4-10 9.1 2.8 13.2L24 34.4 12.2 41.1 15 27.9l-10-9.1 13.4-1.4z"/>',
  blue: '<rect x="9" y="9" width="30" height="30" rx="4"/>',
  black: '<path d="M24 7l18 32H6z"/>',
};
