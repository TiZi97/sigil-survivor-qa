// smoke.spec.js — Sigil Survivor 스모크 테스트 (Playwright)
//
// 목적: 배포 전 5분 안에 "게임이 기본적으로 살아있는가"를 자동 검증한다.
//   1) 페이지 로드 시 콘솔 에러 0건
//   2) 게임 시작 → 캔버스에 실제로 그림이 그려짐 (빈 화면 감지)
//   3) 일시정지 → 로비 복귀 플로우
//   4) 음소거 토글 크래시 없음
//   5) FPS 하한 (5초 평균 30fps 이상)
//
// 실행 (게임 폴더 기준):
//   npm i -D @playwright/test http-server && npx playwright install chromium
//   npx http-server . -p 8080 &   # 게임 정적 서빙
//   npx playwright test smoke.spec.js
//
// CI 팁: GitHub Actions에서 push마다 실행하면 회귀 자동 감지 (references/ci.yml 참고)

const { test, expect } = require('@playwright/test');

const URL = process.env.GAME_URL || 'http://localhost:8080/index.html';

test.describe('Sigil Survivor 스모크', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await page.goto(URL);
  });

  test('로드 시 콘솔 에러 0건 + 시작 화면 노출', async ({ page }) => {
    await expect(page.locator('#startOv')).toBeVisible();
    await expect(page.locator('#startBtn')).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('게임 시작 → 캔버스 렌더링 확인 (빈 화면 감지)', async ({ page }) => {
    await page.click('#startBtn');
    await page.waitForTimeout(1500);
    // 캔버스 픽셀 샘플링: 전부 같은 색이면 렌더링 실패로 간주
    const distinct = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 997)   // 소수 간격 샘플링
        seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return seen.size;
    });
    expect(distinct).toBeGreaterThan(3);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('일시정지 → 로비 복귀 플로우', async ({ page }) => {
    await page.click('#startBtn');
    await page.waitForTimeout(500);
    await page.keyboard.press('p');
    await expect(page.locator('#pauseOv')).toBeVisible();
    await page.click('#pauseLobbyBtn');
    await expect(page.locator('#startOv')).toBeVisible();
    await expect(page.locator('#pauseOv')).toBeHidden();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('음소거 토글 안정성', async ({ page }) => {
    await page.click('#startBtn');
    for (let i = 0; i < 4; i++) await page.keyboard.press('m');
    await page.waitForTimeout(300);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('FPS 하한 — 5초 평균 30fps 이상', async ({ page }) => {
    await page.click('#startBtn');
    await page.waitForTimeout(1000);
    const fps = await page.evaluate(() => new Promise(res => {
      let frames = 0;
      const t0 = performance.now();
      (function tick(){
        frames++;
        if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
        else res(frames / 5);
      })();
    }));
    console.log(`평균 FPS: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThan(30);
  });
});
