// smoke.spec.js — Sigil Survivor 스모크 테스트 (Playwright)
//
// 목적: 배포 전 5분 안에 "게임이 기본적으로 살아있는가"를 자동 검증
//   SMK-01 페이지 로드 시 콘솔 에러 0건 + 시작 화면 노출
//   SMK-02 게임 시작 → 캔버스에 실제로 그림이 그려짐 (빈 화면 감지)
//   SMK-03 일시정지 → 로비 복귀 플로우 (v0.8 신규 기능)
//   SMK-04 음소거 토글 안정성
//   SMK-05 FPS 하한 (5초 평균 30fps 이상)
//
// 실행: README-스모크실행법.md 참고. 스크린샷은 screenshots/ 폴더에 저장된다.

const { test, expect } = require('@playwright/test');

test.describe('Sigil Survivor 스모크', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await page.goto('/index.html');
  });

  test('SMK-01 로드 시 콘솔 에러 0건 + 시작 화면 노출', async ({ page }) => {
    await expect(page.locator('#startOv')).toBeVisible();
    await expect(page.locator('#startBtn')).toBeVisible();
    await page.screenshot({ path: 'screenshots/smk01-start-screen.png' });
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('SMK-02 게임 시작 → 캔버스 렌더링 확인 (빈 화면 감지)', async ({ page }) => {
    await page.click('#startBtn');
    await page.waitForTimeout(2000);
    // 캔버스 픽셀 샘플링: 색상 다양성이 없으면 렌더링 실패로 간주
    const distinct = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 997)   // 소수 간격 샘플링
        seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return seen.size;
    });
    await page.screenshot({ path: 'screenshots/smk02-gameplay.png' });
    expect(distinct, `샘플링된 색상 종류 ${distinct}개 — 4개 미만이면 빈 화면 의심`)
      .toBeGreaterThan(3);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('SMK-03 일시정지 → 로비 복귀 플로우', async ({ page }) => {
    await page.click('#startBtn');
    await page.waitForTimeout(800);
    await page.keyboard.press('p');
    await expect(page.locator('#pauseOv')).toBeVisible();
    await page.screenshot({ path: 'screenshots/smk03a-paused.png' });
    await page.click('#pauseLobbyBtn');
    await expect(page.locator('#startOv')).toBeVisible();
    await expect(page.locator('#pauseOv')).toBeHidden();
    await page.screenshot({ path: 'screenshots/smk03b-back-to-lobby.png' });
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('SMK-04 음소거 토글 안정성', async ({ page }) => {
    await page.click('#startBtn');
    for (let i = 0; i < 4; i++){
      await page.keyboard.press('m');
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: 'screenshots/smk04-mute-toggle.png' });
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('SMK-05 FPS 하한 — 5초 평균 30fps 이상', async ({ page }, testInfo) => {
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
    testInfo.annotations.push({ type: '측정값', description: `평균 ${fps.toFixed(1)} FPS` });
    console.log(`  → 평균 FPS: ${fps.toFixed(1)}`);
    await page.screenshot({ path: 'screenshots/smk05-fps-check.png' });
    expect(fps).toBeGreaterThan(30);
  });
});
