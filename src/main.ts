// 시작점: 서비스 워커 등록, Safari 제스처 차단, 앱 생성.
// WebGL을 만들 수 없으면 숨 쉬는 점토(로딩 화면)를 계속 보여준다 (Design review 3A: 흰 화면 금지).
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';

registerSW({ immediate: true });

// Safari 핀치/더블탭 확대 차단 (CSS touch-action만으로는 gesture 이벤트가 남음)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
// 길게 누르기 메뉴 차단 (R15)
document.addEventListener('contextmenu', (e) => e.preventDefault());

try {
  new App(document.querySelector<HTMLCanvasElement>('#stage')!);
} catch (error) {
  console.error('왁뿌볼 공방을 시작하지 못했습니다', error);
}
