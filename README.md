# 왁뿌볼 공방

초등학생 두 아이를 위한 iPad 웹 놀이. 흰 점토에 물감을 짜서 저으면 실제 물감처럼 섞이고(Mixbox),
완성한 공을 손가락으로 누르면 말랑하게 들어간다. 홈 화면에 추가해 오프라인으로 쓰는 PWA.

## 실행

```bash
npm install
npm run dev        # 같은 Wi-Fi의 iPad에서 http://<Mac IP>:5173
npm test           # 단위 테스트 (Vitest)
npm run build      # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 확인
```

로컬 주소(http)에서는 홈 화면 추가와 오프라인 동작을 확인할 수 없다. 배포 후 확인한다.

## 배포

**Railway:** https://web-production-ff0d6.up.railway.app

- `main`에 push하면 Railway가 자동으로 빌드·배포한다. GitHub Actions 테스트가 통과한 커밋만 배포(`checkSuites`).
- 설정은 `.railway/railway.ts`(Railway IaC): 빌드 `npm run build`, 시작 `npm start`(serve로 `dist` 서빙), 헬스체크 `/`.
  설정을 바꾸면 `npx @railway/cli config plan`으로 확인 후 `config apply`.
- `public/serve.json`: `sw.js`·`index.html`은 no-cache(새 버전이 iPad에 반영되도록), 해시 붙은 `assets/`는 1년 캐시.

**CI:** `.github/workflows/ci.yml`이 push·PR마다 테스트와 빌드를 돌린다. Railway는 이 검사가 통과한 커밋만 배포한다.

iPad에서는 배포 주소를 Safari로 열고 **공유 → 홈 화면에 추가**한 뒤 `docs/ipad-checklist.md`로 확인한다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/paint.ts` | 물감 덩어리 모델: 짜기 양, 젓기, 8개 한도 합치기, 덜어내기, 저장 형식 |
| `src/marble.ts` | 마블 무늬를 꼭짓점 색으로 계산 (Mixbox latent 보간) |
| `src/clay.ts` | 점토 메쉬와 누르기 변형 (자국 깊이·한계, 다시 동그랗게) |
| `src/gestures.ts` | 제스처 상태 기계 (돌리기/누르기/탭/확대/젓기) |
| `src/persist.ts` | 작품·이전 공·설정 저장 (localStorage) |
| `src/audio.ts` | Web Audio 합성 소리 6종 |
| `src/app.ts` | 위 모듈을 화면·버튼에 연결 |
| `src/wood.ts` | 나뭇결·접지 그림자 생성 |

설계와 리뷰 기록: `~/.gstack/projects/jakeheo/jakeheo-nobranch-design-20261011-151655.md`

## 폰트

화면 글자를 바꾸면 폰트 서브셋을 다시 만든다 (`pip install fonttools brotli` 필요).

```bash
scripts/subset-font.sh path/to/Jua-Regular.ttf
```

## 라이선스 메모

- 색 섞기: [Mixbox](https://github.com/scrtwpns/mixbox) © Secret Weapons, **CC BY-NC 4.0** (비상업용만, 앱 부모 화면에 출처 표기). 판매하려면 별도 라이선스 필요.
- 폰트: Jua © The Jua Project Authors, SIL Open Font License 1.1 (`public/fonts/OFL-Jua.txt`).
