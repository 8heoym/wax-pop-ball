// 앱 컨트롤러: 물감(paint) · 점토(clay) · 무늬(marble) · 제스처(gestures) · 저장(persist) · 소리(audio)를
// 화면과 버튼에 연결한다 (T6, Design review 1A~19A, Eng re-review R9~R15).
import * as THREE from 'three';
import { SoundBoard } from './audio';
import { ClayDeformer, RESTORE_SECONDS, createClayGeometry } from './clay';
import { createShadowCanvas, createWoodTexture } from './wood';
import { GestureRecognizer, type GestureEvent } from './gestures';
import { CAP_SHAPES, ICONS } from './icons';
import { MarbleField, srgbToLinear } from './marble';
import { PaintState, type Vec3 } from './paint';
import { TUBES, TUBE_ORDER, type TubeId } from './palette';
import { PieceStore, type Piece, type PieceMode, type Prefs } from './persist';

const BALL_SCREEN_FRACTION = 0.55;
const CAMERA_DISTANCE = 4.4;
const CAMERA_MIX = new THREE.Vector3(0, 2.4, 3.7).setLength(CAMERA_DISTANCE);
const CAMERA_PRESS = new THREE.Vector3(0, 0.5, 4.4).setLength(CAMERA_DISTANCE);
const CAMERA_SWING_SECONDS = 0.8;
const AUTO_ROTATE_RADIANS_PER_SECOND = THREE.MathUtils.degToRad(6);
const MARBLE_UPDATE_INTERVAL_MS = 100;
const IDLE_SLEEP_MS = 1000;
const HINT_IDLE_MS = 4000;
const HINTS_PER_MODE = 3;
const NEW_CLAY_CONFIRM_MS = 3000;
const PARENT_HOLD_MS = 2000;
const SAVE_DEBOUNCE_MS = 400;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface CameraSwing {
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
  onDone?: () => void;
}

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly ball = new THREE.Group();
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly clay: ClayDeformer;
  private readonly marble: MarbleField;
  private readonly gestures: GestureRecognizer;
  private readonly store = PieceStore.fromWindow();
  private readonly sound: SoundBoard;
  private readonly raycaster = new THREE.Raycaster();
  private readonly srgbColors: Float32Array;
  private prefs: Prefs;
  private paint = new PaintState();
  private mode: PieceMode = 'mix';
  private zoom = 1;

  private marbleDirty = true;
  private lastMarbleUpdate = -Infinity;
  private needsRender = true;
  /** 화면이 바뀐 마지막 시각 (렌더 루프 잠들기 판단) */
  private lastActivity = 0;
  /** 사람이 마지막으로 만진 시각 (안내 손가락 판단). 자동 회전은 입력이 아니다 */
  private lastInputAt = 0;
  private sleeping = false;
  private lastFrame = 0;
  private swing: CameraSwing | null = null;
  private bounceStartedAt = -1;
  private shimmerStartedAt = -1;
  private restoreStartedAt = -1;
  private squeezing: { tube: TubeId; pointerId: number; startedAt: number; element: HTMLElement } | null = null;
  private lastStirAt = 0;
  private newClayArmedTimer = 0;
  private parentHoldTimer = 0;
  private saveTimer = 0;
  private hintVisible = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // WebGL을 만들 수 없으면 여기서 예외: main.ts가 숨 쉬는 점토를 계속 보여준다 (3A)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // D10
    // 배경은 투명: 뒤의 나무 작업대(CSS)가 보인다 (12A)
    this.renderer.setClearColor(0x000000, 0);
    document.body.style.setProperty('--wood-texture', `url(${createWoodTexture()})`);

    this.prefs = this.store.loadPrefs();
    this.sound = new SoundBoard(this.prefs.muted);

    // 12A: 왼쪽 위 부드러운 주광 + 뒤쪽 림라이트
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0xe0c49a, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(-3, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2c4, 0.8);
    rim.position.set(2, 1.5, -4);
    this.scene.add(rim);

    const geometry = createClayGeometry();
    const positions = geometry.getAttribute('position').array as Float32Array;
    this.clay = new ClayDeformer(positions);
    this.marble = new MarbleField(this.clay.directions);
    this.srgbColors = new Float32Array(positions.length);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 }),
    );
    this.ball.add(this.mesh);
    this.scene.add(this.ball);

    // 공 아래 접지 그림자: 공과 함께 돌지 않도록 장면에 직접 둔다
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(createShadowCanvas()), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.02;
    this.scene.add(shadow);

    this.gestures = new GestureRecognizer({
      isOnBall: (x, y) => this.isOnBall(x, y),
      shortSide: () => Math.min(window.innerWidth, window.innerHeight),
    });

    this.buildHud();
    this.bindEvents();
    this.restoreSavedPiece();
    this.updatePreviousBall();
    this.resize();
    this.lastActivity = performance.now();
    this.lastInputAt = this.lastActivity;
    this.renderer.setAnimationLoop((t) => this.frame(t));
    $('#app-version').textContent = __APP_VERSION__;
  }

  // ── 초기화 ─────────────────────────────

  private buildHud(): void {
    $('#parent-button').innerHTML = ICONS.gear;
    $('#to-workbench').innerHTML = ICONS.brush;
    $('#done-button').innerHTML = ICONS.check;
    $('#undo-squeeze').innerHTML = ICONS.undo;
    $('#round-again').innerHTML = ICONS.roundAgain;
    $('#new-clay').insertAdjacentHTML('afterbegin', ICONS.newClay);
    this.updateSoundIcon();

    const drawer = $('#tube-drawer');
    for (const tube of TUBE_ORDER) {
      const button = document.createElement('button');
      button.className = 'tube';
      button.dataset.tube = tube;
      button.setAttribute('aria-label', `${TUBE_NAMES[tube]} 물감`);
      button.style.setProperty('--tube-color', `rgb(${TUBES[tube].join(',')})`);
      button.innerHTML = `<span class="tube__body"></span><span class="tube__label"></span>
        <svg class="tube__cap" viewBox="0 0 48 48" aria-hidden="true">${CAP_SHAPES[tube]}</svg>`;
      drawer.append(button);
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    // 첫 터치에서 소리 활성화 (Safari 제약)
    window.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    window.addEventListener('pointerdown', () => this.noteInput(), { capture: true });

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.handleGestures(this.gestures.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp));
    });
    c.addEventListener('pointermove', (e) => {
      if (e.buttons) this.lastInputAt = performance.now();
      this.handleGestures(this.gestures.pointerMove(e.pointerId, e.clientX, e.clientY, e.timeStamp));
    });
    const up = (e: PointerEvent) => {
      this.handleGestures(this.gestures.pointerUp(e.pointerId, e.timeStamp));
      this.scheduleSave();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.handleGestures(this.gestures.pointerCancel(e.pointerId)));

    // 물감 튜브 (4A)
    const drawer = $('#tube-drawer');
    drawer.addEventListener('pointerdown', (e) => {
      const element = (e.target as HTMLElement).closest<HTMLElement>('.tube');
      if (!element || this.squeezing) return;
      element.setPointerCapture(e.pointerId);
      this.startSqueeze(element.dataset.tube as TubeId, e.pointerId, element);
    });
    const endSqueeze = (e: PointerEvent) => {
      if (this.squeezing?.pointerId === e.pointerId) this.endSqueeze();
    };
    drawer.addEventListener('pointerup', endSqueeze);
    drawer.addEventListener('pointercancel', endSqueeze);
    drawer.addEventListener('lostpointercapture', endSqueeze);

    $('#undo-squeeze').addEventListener('click', () => this.undoSqueeze());
    $('#done-button').addEventListener('click', () => this.finish());
    $('#to-workbench').addEventListener('click', () => this.backToWorkbench());
    $('#round-again').addEventListener('click', () => this.roundAgain());
    $('#new-clay').addEventListener('click', () => this.newClayTapped());
    $('#previous-ball').addEventListener('click', () => this.swapPrevious());
    $('#sound-toggle').addEventListener('click', () => this.toggleSound());

    // 17A: 부모 화면은 2초 길게 눌러야 열림, 짧은 탭은 무반응
    const parent = $('#parent-button');
    parent.addEventListener('pointerdown', () => {
      window.clearTimeout(this.parentHoldTimer);
      this.parentHoldTimer = window.setTimeout(() => ($('#parent-panel').hidden = false), PARENT_HOLD_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      parent.addEventListener(type, () => window.clearTimeout(this.parentHoldTimer));
    }
    $('#parent-close').addEventListener('click', () => ($('#parent-panel').hidden = true));

    // 백그라운드로 갈 때 저장 (D6)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
      else this.wake();
    });
    window.addEventListener('pagehide', () => this.saveNow());

    // 3D 화면 손실/복구 (D6, 3A): 손실 중에는 숨 쉬는 점토
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.body.classList.remove('is-ready');
    });
    c.addEventListener('webglcontextrestored', () => {
      const geometry = this.mesh.geometry;
      for (const name of ['position', 'normal', 'color']) geometry.getAttribute(name).needsUpdate = true;
      document.body.classList.add('is-ready');
      this.wake();
    });
  }

  private restoreSavedPiece(): void {
    const piece = this.store.loadCurrent();
    if (!piece) {
      this.setMode('mix', false);
    } else if (!this.applyPiece(piece)) {
      this.store.discardCurrent();
    }
    this.writeGeometry();
  }

  /** 저장된 작품을 화면에 적용. 점토 모양이 맞지 않으면 false (새 점토로 시작) */
  private applyPiece(piece: Piece): boolean {
    if (!this.clay.restoreRadii(piece.radii)) {
      this.resetPiece();
      return false;
    }
    this.paint = new PaintState(piece.paint);
    this.ball.quaternion.fromArray(piece.rotation);
    this.zoom = piece.mode === 'press' ? piece.zoom : 1;
    this.setMode(piece.mode, false);
    this.marbleDirty = true;
    this.writeGeometry();
    return true;
  }

  private resetPiece(): void {
    this.paint = new PaintState();
    this.clay.reset();
    this.ball.quaternion.identity();
    this.zoom = 1;
    this.marbleDirty = true;
    this.setMode('mix', false);
    this.writeGeometry();
  }

  private currentPiece(): Piece {
    const q = this.ball.quaternion.normalize();
    return {
      version: 2,
      paint: this.paint.toSnapshot(),
      radii: this.clay.serializeRadii(),
      mode: this.mode,
      rotation: [q.x, q.y, q.z, q.w],
      zoom: this.zoom,
    };
  }

  // ── 모드 ─────────────────────────────

  private setMode(mode: PieceMode, animate: boolean, onDone?: () => void): void {
    this.mode = mode;
    document.body.dataset.mode = mode;
    this.handleGestures(this.gestures.setMode(mode));
    this.updateFullyMixedClass();
    this.updateUndoButton();
    this.updateMedal();
    const target = this.cameraTarget();
    if (animate) {
      this.swing = { from: this.camera.position.clone(), to: target, startedAt: performance.now(), onDone };
    } else {
      this.swing = null;
      this.camera.position.copy(target);
      this.camera.lookAt(0, 0, 0);
      onDone?.();
    }
    this.hideHint();
    this.wake();
  }

  private cameraTarget(): THREE.Vector3 {
    const base = this.mode === 'mix' ? CAMERA_MIX : CAMERA_PRESS;
    return base.clone().setLength(CAMERA_DISTANCE / this.zoom);
  }

  /** 완성 (9A): 카메라 스윙 → 공 한 번 튀기 + 반짝이 + 종소리 + 색 메달 */
  private finish(): void {
    if (this.mode !== 'mix') return;
    this.endSqueeze();
    this.updateMarble(performance.now(), true);
    this.setMode('press', true, () => {
      this.bounceStartedAt = performance.now();
      this.burstSparkles();
      this.sound.chime(true);
    });
    this.saveNow();
  }

  /** 2A: 작업대로. 자국은 그대로, 색만 더 섞을 수 있다 */
  private backToWorkbench(): void {
    if (this.mode !== 'press') return;
    this.zoom = 1;
    this.setMode('mix', true);
    this.saveNow();
  }

  // ── 물감 짜기 (4A, 11A, R13) ─────────────────────────────

  private startSqueeze(tube: TubeId, pointerId: number, element: HTMLElement): void {
    this.paint.startSqueeze(tube, this.squeezeCenter());
    this.squeezing = { tube, pointerId, startedAt: performance.now(), element };
    element.classList.add('is-squeezing');
    this.sound.squishStart(this.paint.updateSqueeze(0));
    this.marbleDirty = true;
    this.updateFullyMixedClass();
    this.wake();
  }

  private updateSqueeze(now: number): void {
    if (!this.squeezing) return;
    const held = (now - this.squeezing.startedAt) / 1000;
    const amount = this.paint.updateSqueeze(held);
    this.sound.squishUpdate(amount);
    this.squeezing.element.classList.toggle('is-maxed', this.paint.isSqueezeMaxed(held));
    this.marbleDirty = true;
    this.lastInputAt = now;
    this.noteActivity(now);
  }

  private endSqueeze(): void {
    if (!this.squeezing) return;
    this.squeezing.element.classList.remove('is-squeezing', 'is-maxed');
    this.squeezing = null;
    this.paint.endSqueeze();
    this.sound.squishStop();
    this.marbleDirty = true;
    this.updateUndoButton();
    this.scheduleSave();
  }

  /** 짜기 시작 순간, 카메라에서 보이는 공 윗부분을 공의 원래 좌표로 (R13) */
  private squeezeCenter(): Vec3 {
    const toCamera = this.camera.position.clone().normalize();
    const world = toCamera.multiplyScalar(0.7).add(new THREE.Vector3(0, 0.55, 0)).normalize();
    const local = world.applyQuaternion(this.ball.quaternion.clone().invert());
    return [local.x, local.y, local.z];
  }

  private undoSqueeze(): void {
    if (this.paint.undoLastSqueeze()) {
      this.marbleDirty = true;
      this.updateUndoButton();
      this.updateFullyMixedClass();
      this.scheduleSave();
      this.wake();
    }
  }

  private updateUndoButton(): void {
    $('#undo-squeeze').hidden = this.mode !== 'mix' || !this.paint.canUndoLastSqueeze();
  }

  // ── 제스처 → 동작 ─────────────────────────────

  private handleGestures(events: GestureEvent[]): void {
    const now = performance.now();
    for (const event of events) {
      switch (event.type) {
        case 'stir': {
          const dt = Math.max(16, now - this.lastStirAt) / 1000;
          this.lastStirAt = now;
          const nowFull = this.paint.stir(event.distance);
          this.sound.stirUpdate(event.distance / dt);
          this.marbleDirty = true;
          this.updateUndoButton();
          if (nowFull) this.celebrateFullyMixed(now);
          break;
        }
        case 'rotate': {
          const short = Math.min(window.innerWidth, window.innerHeight);
          const k = (Math.PI * 1.2) / short;
          const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), event.dx * k);
          const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), event.dy * k);
          this.ball.quaternion.premultiply(qy).premultiply(qx).normalize();
          break;
        }
        case 'pressStart': {
          const point = this.pickBall(event.x, event.y);
          if (point) {
            this.clay.beginPress(point);
            this.sound.pop();
          }
          break;
        }
        case 'pressUpdate':
          if (this.clay.updatePress(event.heldSeconds)) this.writeGeometry();
          break;
        case 'pressEnd':
          this.clay.endPress();
          this.scheduleSave();
          break;
        case 'pressCancel':
          this.clay.cancelPress();
          break;
        case 'tap': {
          const point = this.pickBall(event.x, event.y);
          if (point) {
            this.clay.tap(point);
            this.sound.pop();
            this.writeGeometry();
            this.scheduleSave();
          }
          break;
        }
        case 'zoom':
          this.zoom = event.zoom;
          if (!this.swing) this.camera.position.copy(this.cameraTarget());
          break;
      }
    }
    if (events.length > 0) this.noteActivity(now);
  }

  /** 화면 좌표 → 공 표면의 원래 좌표 방향. 공을 벗어나면 null */
  private pickBall(x: number, y: number): Vec3 | null {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    const local = this.ball.worldToLocal(hit.point.clone()).normalize();
    return [local.x, local.y, local.z];
  }

  private isOnBall(x: number, y: number): boolean {
    const center = new THREE.Vector3().project(this.camera);
    const cx = ((center.x + 1) / 2) * window.innerWidth;
    const cy = ((1 - center.y) / 2) * window.innerHeight;
    const distance = this.camera.position.length();
    const radius = (1 / (distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))) * (window.innerHeight / 2);
    return Math.hypot(x - cx, y - cy) <= radius;
  }

  // ── 버튼 ─────────────────────────────

  private roundAgain(): void {
    this.sound.tong();
    if (!this.clay.isDented() || this.clay.isRestoring()) return;
    this.clay.beginRestore();
    this.restoreStartedAt = performance.now();
    this.handleGestures(this.gestures.setBlocked(true));
    this.wake();
  }

  /** 5A: 첫 탭은 확인(흔들림 + 3초 고리), 3초 안에 두 번째 탭이면 새 점토 */
  private newClayTapped(): void {
    const button = $('#new-clay');
    if (!button.classList.contains('is-armed')) {
      button.classList.add('is-armed');
      window.clearTimeout(this.newClayArmedTimer);
      this.newClayArmedTimer = window.setTimeout(() => button.classList.remove('is-armed'), NEW_CLAY_CONFIRM_MS);
      return;
    }
    window.clearTimeout(this.newClayArmedTimer);
    button.classList.remove('is-armed');
    // 10A: 지금 공은 '이전 공'으로
    this.store.moveCurrentToPrevious(this.currentPiece());
    this.resetPiece();
    this.updatePreviousBall();
    this.swing = { from: this.camera.position.clone(), to: this.cameraTarget(), startedAt: performance.now() };
  }

  private swapPrevious(): void {
    this.endSqueeze();
    const previous = this.store.swapWithPrevious(this.currentPiece());
    if (!previous) return;
    if (!this.applyPiece(previous)) this.store.discardCurrent();
    this.updatePreviousBall();
    this.wake();
  }

  private updatePreviousBall(): void {
    const previous = this.store.loadPrevious();
    const button = $('#previous-ball');
    button.hidden = !previous;
    if (previous) {
      const rgb = new PaintState(previous.paint).finalRgb();
      button.style.setProperty('--previous-color', `rgb(${rgb.join(',')})`);
    }
  }

  private toggleSound(): void {
    this.sound.setMuted(!this.sound.isMuted());
    this.prefs.muted = this.sound.isMuted();
    this.store.savePrefs(this.prefs);
    this.updateSoundIcon();
  }

  private updateSoundIcon(): void {
    const button = $('#sound-toggle');
    const muted = this.sound.isMuted();
    button.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  }

  private updateMedal(): void {
    const rgb = this.paint.finalRgb();
    $('#medal').style.setProperty('--medal-color', `rgb(${rgb.join(',')})`);
  }

  // ── 연출 (6A, 9A) ─────────────────────────────

  private celebrateFullyMixed(now: number): void {
    this.shimmerStartedAt = now;
    this.sound.chime();
    this.updateFullyMixedClass();
  }

  private updateFullyMixedClass(): void {
    document.body.classList.toggle('is-fully-mixed', this.mode === 'mix' && this.paint.isFullyMixed());
  }

  private burstSparkles(): void {
    const layer = $('#sparkles');
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.3;
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const spark = document.createElement('div');
      spark.className = 'sparkle';
      spark.style.left = `${cx + Math.cos(angle) * radius * 0.8}px`;
      spark.style.top = `${cy + Math.sin(angle) * radius * 0.8}px`;
      spark.style.setProperty('--dx', `${Math.cos(angle) * radius * 0.35}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * radius * 0.35}px`);
      layer.append(spark);
      window.setTimeout(() => spark.remove(), 900);
    }
  }

  // ── 안내 손가락 (7A) ─────────────────────────────

  private noteInput(): void {
    this.hideHint();
    this.lastInputAt = performance.now();
    this.noteActivity(this.lastInputAt);
    this.wake();
  }

  private hideHint(): void {
    if (!this.hintVisible) return;
    this.hintVisible = false;
    $('#ghost-finger').hidden = true;
  }

  private maybeShowHint(now: number): void {
    if (this.hintVisible || now - this.lastInputAt < HINT_IDLE_MS || this.squeezing || this.swing) return;
    if (!$('#parent-panel').hidden) return;
    const shown = this.prefs.hintsShown[this.mode];
    if (shown >= HINTS_PER_MODE) return;

    const finger = $('#ghost-finger');
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let hint: string;
    if (this.mode === 'mix' && this.paint.getBlobs().length === 1) {
      const tube = document.querySelector<HTMLElement>('.tube[data-tube="blue"]')!.getBoundingClientRect();
      x = tube.left + tube.width / 2;
      y = tube.top + tube.height / 2;
      hint = 'tap';
    } else if (this.mode === 'mix') {
      hint = 'rub';
    } else {
      hint = shown % 2 === 0 ? 'drag' : 'hold';
    }
    finger.style.left = `${x}px`;
    finger.style.top = `${y}px`;
    finger.dataset.hint = hint;
    finger.hidden = false;
    this.hintVisible = true;
    this.prefs.hintsShown[this.mode] = shown + 1;
    this.store.savePrefs(this.prefs);
  }

  // ── 저장 ─────────────────────────────

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  private saveNow(): void {
    window.clearTimeout(this.saveTimer);
    this.store.saveCurrent(this.currentPiece());
  }

  // ── 매 프레임 ─────────────────────────────

  private noteActivity(now: number): void {
    this.lastActivity = now;
    this.needsRender = true;
  }

  /** R14: 누르기 모드에서 1초 이상 아무것도 없으면 렌더 루프를 멈춘다. 입력이 오면 다시 시작 */
  private wake(): void {
    this.needsRender = true;
    if (!this.sleeping) return;
    this.sleeping = false;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    let animating = false;

    for (const event of this.gestures.tick(now)) this.handleGestures([event]);
    if (this.squeezing) {
      this.updateSqueeze(now);
      animating = true;
    }

    // 18A: 섞기 모드에서 손이 닿아 있지 않으면 공이 천천히 돈다
    if (this.mode === 'mix' && !this.gestures.isTouching() && !this.squeezing && !this.swing) {
      this.ball.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), AUTO_ROTATE_RADIANS_PER_SECOND * dt);
      animating = true;
    }
    // 손가락이 멈추면 문지르는 소리를 서서히 끈다
    if (now - this.lastStirAt > 120) this.sound.stirUpdate(0);

    if (this.swing) {
      const t = Math.min(1, (now - this.swing.startedAt) / 1000 / CAMERA_SWING_SECONDS);
      this.camera.position.lerpVectors(this.swing.from, this.swing.to, easeInOut(t));
      this.camera.position.setLength(THREE.MathUtils.lerp(this.swing.from.length(), this.swing.to.length(), easeInOut(t)));
      this.camera.lookAt(0, 0, 0);
      animating = true;
      if (t >= 1) {
        const done = this.swing.onDone;
        this.swing = null;
        done?.();
      }
    }

    if (this.bounceStartedAt >= 0) {
      const t = (now - this.bounceStartedAt) / 300;
      const scale = t >= 1 ? 1 : 1 + 0.06 * Math.sin(Math.PI * t);
      this.ball.scale.setScalar(scale);
      if (t >= 1) this.bounceStartedAt = -1;
      animating = true;
    }

    if (this.shimmerStartedAt >= 0) {
      const t = (now - this.shimmerStartedAt) / 600;
      this.mesh.material.emissiveIntensity = t >= 1 ? 0 : 0.35 * Math.sin(Math.PI * t);
      if (t >= 1) this.shimmerStartedAt = -1;
      animating = true;
    }

    if (this.restoreStartedAt >= 0) {
      const still = this.clay.updateRestore((now - this.restoreStartedAt) / 1000);
      this.writeGeometry();
      if (!still || now - this.restoreStartedAt > RESTORE_SECONDS * 1000 + 100) {
        this.restoreStartedAt = -1;
        this.handleGestures(this.gestures.setBlocked(false));
        this.scheduleSave();
      }
      animating = true;
    }

    this.updateMarble(now, false);
    if (animating) this.noteActivity(now);
    this.maybeShowHint(now);

    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
      if (!document.body.classList.contains('is-ready')) document.body.classList.add('is-ready');
    }

    const touching = this.gestures.isTouching();
    if (this.mode === 'press' && !touching && !animating && now - this.lastActivity > IDLE_SLEEP_MS) {
      this.sleeping = true;
      this.renderer.setAnimationLoop(null);
      // 잠든 동안에도 안내 손가락(7A)이 나올 수 있게 깨울 시각을 예약
      if (this.prefs.hintsShown.press < HINTS_PER_MODE && !this.hintVisible) {
        window.setTimeout(() => this.wake(), Math.max(0, this.lastInputAt + HINT_IDLE_MS - now) + 50);
      }
    }
  }

  /** 무늬는 0.1초 간격으로만 다시 계산 (Mac 기준 약 5ms) */
  private updateMarble(now: number, force: boolean): void {
    if (!this.marbleDirty) return;
    if (!force && now - this.lastMarbleUpdate < MARBLE_UPDATE_INTERVAL_MS) return;
    this.marbleDirty = false;
    this.lastMarbleUpdate = now;
    this.marble.computeSrgb(this.paint.getBlobs(), this.paint.finalLatent(), this.srgbColors);
    const colors = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    srgbToLinear(this.srgbColors, colors.array as Float32Array);
    colors.needsUpdate = true;
    this.updateMedal();
    this.needsRender = true;
  }

  private writeGeometry(): void {
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.clay.writePositions(position.array as Float32Array);
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    this.needsRender = true;
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // 1A: 공이 화면 짧은 변의 55%가 되도록 세로 시야각 조정 (기본 거리 기준)
    const fraction = BALL_SCREEN_FRACTION * (Math.min(width, height) / height);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / (fraction * CAMERA_DISTANCE)));
    this.camera.updateProjectionMatrix();
    this.wake();
  }
}

const TUBE_NAMES: Record<TubeId, string> = {
  white: '흰색',
  red: '빨강',
  pink: '분홍',
  yellow: '노랑',
  blue: '파랑',
  black: '검정',
};
