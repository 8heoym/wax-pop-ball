/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// 빌드 버전: 부모용 정보 화면에 표시 (Eng review D5)
const buildVersion = `${pkg.version}+${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

export default defineConfig({
  // GitHub Pages 같은 하위 경로 배포를 위해 상대 경로 사용
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  plugins: [
    VitePWA({
      // D5: 새 버전이 받아지면 바로 활성화 (skipWaiting + clientsClaim)
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      workbox: {
        // 오프라인 동작: 앱 셸 전부 precache. 폰트/소리는 이후 작업에서 추가
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,mp3,m4a}'],
        // three + mixbox(LUT 내장) 번들이 2MB 기본 한도를 넘을 수 있음
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: '왁뿌볼 공방',
        short_name: '왁뿌볼',
        lang: 'ko',
        display: 'standalone',
        // 1A: 가로 고정
        orientation: 'landscape',
        background_color: '#E9CFA6',
        theme_color: '#E9CFA6',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
