// T1 골격: 나무 작업대 위의 흰 점토 공 하나를 그린다.
// 물감(paint.ts), 누르기(clay.ts), 제스처(gestures.ts)는 T2~T4에서 추가.
import './styles.css';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

// Safari 핀치/더블탭 확대 차단 (CSS touch-action만으로는 gesture 이벤트가 남음)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// D10: 해상도 상한 2
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xe9cfa6);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
// 섞기 모드: 위에서 비스듬히 내려다봄
camera.position.set(0, 2.2, 4.2);
camera.lookAt(0, 0, 0);

// 12A: 왼쪽 위 부드러운 주광 + 뒤쪽 림라이트
scene.add(new THREE.HemisphereLight(0xfff4e6, 0xc9a574, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-3, 4, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffe2c4, 0.8);
rim.position.set(2, 1.5, -4);
scene.add(rim);

// D3: 이음매 없는 축구공식 구. UV/법선을 지우고 꼭짓점을 합쳐야 법선 재계산 시 줄이 생기지 않음
function createClayGeometry(): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 32);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

const clay = new THREE.Mesh(
  createClayGeometry(),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }),
);
scene.add(clay);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // 1A: 공이 화면 짧은 변의 약 55%가 되도록 세로 시야각 조정
  const shortSide = Math.min(width, height);
  const ballFraction = 0.55 * (shortSide / height);
  const distance = camera.position.length();
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / (ballFraction * distance)));
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

console.info(`왁뿌볼 공방 ${__APP_VERSION__}, 꼭짓점 ${clay.geometry.getAttribute('position').count}개`);
