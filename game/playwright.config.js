// playwright.config.js — 스모크 테스트 설정
// 특징: 테스트 시작 시 게임 서버(http-server)를 자동으로 띄우고, 끝나면 자동 종료.
//       모든 테스트의 스크린샷을 남기고 HTML 리포트를 생성한다.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testMatch: ['smoke.spec.js', 'functional.spec.js'],
  timeout: 60000,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:8080',
    screenshot: 'on',            // 성공/실패 모두 스크린샷 저장 (포트폴리오 재료)
    video: 'retain-on-failure',  // 실패 시 영상까지 남김 (버그 리포트 첨부용)
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx http-server . -p 8080 -s',   // 게임 정적 서버 자동 실행
    url: 'http://localhost:8080/index.html',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
