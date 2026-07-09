// functional.spec.js — 기능 회귀 스위트 (v0.9.3+)
//
// 스모크(BAT)가 "빌드가 살아있는가"를 본다면, 이 스위트는 핵심 기능의
// 동작 규칙을 검증한다. 게임의 테스트 모드(?test=1)를 사용해:
//   - 자동 스폰을 정지시켜 결정적(deterministic) 환경을 만들고
//   - window.__T 훅으로 상태를 주입/관찰한다 (픽셀 비교가 아닌 상태 검증)
//
//   F-01 시길 드로잉 E2E — 도형 4종 각각 마우스 제스처 → 발동·게이지·도감 검증
//   F-02 시길 불발 — 낙서 입력 → 정확히 -10 페널티, 도감 미등록
//   F-03 도감 표시 — 20칸 균일 ?, 힌트 클릭/복귀 (BUG-002 회귀)
//   F-04 난이도 해금 — 클리어 기록 유무 시나리오 (localStorage 제어)
//   F-05 일시정지 상태 보존 — 적 좌표·게임 시간 완전 정지 후 재개
//   F-06 자석 진공 흡수 — 필드 젬 전량 흡수 (v0.9 회귀)
//   F-07 에셋 폴백 — floor.png 로딩 강제 실패 → 그리드 폴백, 크래시 없음
//   F-08 에셋 규격 계약 — 플레이어 상태별 스프라이트 치수 일치 (BUG-001 회귀)
//
// 실행: npm test (스모크와 함께 실행됨) / npx playwright test functional.spec.js

const { test, expect } = require('@playwright/test');

const CX = 640, CY = 360;   // 뷰포트(1280×720) 중심 = 플레이어 위치

// 마우스 제스처 합성: 경유점을 따라 드로잉 (steps로 pointermove 밀도 확보)
async function drawGesture(page, waypoints, steps = 6){
  await page.keyboard.press('e');                    // 드로잉 모드 진입
  await page.waitForTimeout(120);
  await page.mouse.move(waypoints[0].x, waypoints[0].y);
  await page.mouse.down();
  for (let i = 1; i < waypoints.length; i++)
    await page.mouse.move(waypoints[i].x, waypoints[i].y, { steps });
  await page.mouse.up();                             // 판정 트리거
  await page.waitForTimeout(150);
}

const circlePath = () => Array.from({length: 22}, (_, i) => ({
  x: CX + Math.cos(i / 21 * Math.PI * 2) * 90,
  y: CY + Math.sin(i / 21 * Math.PI * 2) * 90,
}));
const boltPath = () => [
  {x: CX + 45, y: CY - 70}, {x: CX, y: CY},
  {x: CX + 28, y: CY - 6}, {x: CX - 12, y: CY + 75}];
const veePath = () => [
  {x: CX - 75, y: CY - 55}, {x: CX, y: CY + 55}, {x: CX + 75, y: CY - 55}];
const linePath = () => [{x: CX - 90, y: CY}, {x: CX + 90, y: CY}];

async function startTestGame(page){
  await page.goto('/index.html?test=1');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__T && window.__T.g());
}

test.describe('기능 회귀 스위트', () => {

  test('F-01 시길 드로잉 E2E — 4종 발동·게이지·도감', async ({ page }) => {
    await startTestGame(page);

    // 원 → 수호 원환: 실드 생성 + 게이지 25 소모
    await page.evaluate(() => window.__T.setSigil(100));
    await drawGesture(page, circlePath(), 3);
    expect(await page.evaluate(() => window.__T.player().shield),
      '원 시길: 실드 미생성').toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__T.player().sigil)).toBeCloseTo(75, 0);

    // 번개 → 낙뢰: 근접 적에게 피해
    await page.evaluate(() => window.__T.spawnAt('chaser',
      window.__T.player().x + 60, window.__T.player().y));
    const hpBefore = await page.evaluate(() => window.__T.g().enemies[0].hp);
    await page.evaluate(() => window.__T.setSigil(100));
    await drawGesture(page, boltPath(), 8);
    const hpAfter = await page.evaluate(() => {
      const e = window.__T.g().enemies[0];
      return e ? e.hp : -1;                          // 처치되어 제거됐으면 -1
    });
    expect(hpAfter < hpBefore || hpAfter === -1, '번개 시길: 피해 미적용').toBe(true);

    // V → 질풍: 이동속도 버프
    await page.evaluate(() => window.__T.setSigil(100));
    await drawGesture(page, veePath(), 8);
    expect(await page.evaluate(() => window.__T.player().spdBuffT),
      'V 시길: 속도 버프 미적용').toBeGreaterThan(0);

    // 직선 → 참풍: 발동(게이지 25 소모) — 빠른 플릭 재현 (v0.9.2 회귀)
    await page.evaluate(() => window.__T.setSigil(100));
    await drawGesture(page, linePath(), 5);
    expect(await page.evaluate(() => window.__T.player().sigil)).toBeCloseTo(75, 0);

    // 도감: 4종 모두 발견 등록
    const codex = await page.evaluate(() => window.__T.codex());
    for (const k of ['circle', 'bolt', 'vee', 'line'])
      expect(codex[k], `도감 미등록: ${k}`).toBeTruthy();
  });

  test('F-02 시길 불발 — 낙서는 정확히 -10, 도감 미등록', async ({ page }) => {
    await startTestGame(page);
    await page.evaluate(() => window.__T.setSigil(100));
    // 인식 불가능한 낙서 (교차 지그재그)
    await drawGesture(page, [
      {x: CX, y: CY}, {x: CX + 60, y: CY - 40}, {x: CX - 50, y: CY + 30},
      {x: CX + 40, y: CY + 50}, {x: CX - 60, y: CY - 50}, {x: CX + 10, y: CY + 10}], 4);
    expect(await page.evaluate(() => window.__T.player().sigil),
      '불발 페널티는 정확히 SIGIL_FAIL_COST(10)여야 함').toBeCloseTo(90, 0);
    const codex = await page.evaluate(() => window.__T.codex());
    expect(Object.keys(codex).length, '낙서로 도감이 등록되면 안 됨').toBe(0);
  });

  test('F-03 도감 — 미발견 균일 표시 + 문양 힌트 (BUG-002 회귀)', async ({ page }) => {
    await page.goto('/index.html?test=1');
    await page.click('#codexBtn');
    const slots = page.locator('#codexGrid .slot');
    await expect(slots).toHaveCount(20);
    await expect(page.locator('#codexGrid .slot.unlocked')).toHaveCount(0);
    // BUG-002 핵심: 미발견 슬롯에 티어 배경 클래스가 없어야 함
    await expect(page.locator('#codexGrid .slot.t1')).toHaveCount(0);
    await expect(page.locator('#codexGrid .slot.hintable')).toHaveCount(4);
    // 힌트: 클릭 → SVG 문양 → 2.6초 후 ? 복귀
    const first = page.locator('#codexGrid .slot.hintable').first();
    await first.click();
    await expect(first.locator('svg')).toBeVisible();
    await page.waitForTimeout(2900);
    await expect(first.locator('.q')).toHaveText('?');
  });

  test('F-04 난이도 해금 — 클리어 기록 시나리오', async ({ page }) => {
    // 기록 없음: 보통만 활성
    await page.goto('/index.html?test=1');
    const btns = page.locator('#diffRow button');
    await expect(btns).toHaveCount(3);
    await expect(btns.nth(0)).toBeEnabled();
    await expect(btns.nth(1)).toBeDisabled();
    await expect(btns.nth(2)).toBeDisabled();
    // 보통 클리어 기록 주입 → 어려움만 해금
    await page.evaluate(() =>
      localStorage.setItem('ss_clears', JSON.stringify({normal: true})));
    await page.reload();
    await expect(page.locator('#diffRow button').nth(1)).toBeEnabled();
    await expect(page.locator('#diffRow button').nth(2)).toBeDisabled();
  });

  test('F-05 일시정지 — 상태 완전 정지 후 재개', async ({ page }) => {
    await startTestGame(page);
    await page.evaluate(() => window.__T.spawnAt('chaser',
      window.__T.player().x + 300, window.__T.player().y));
    await page.keyboard.press('p');
    const snap = await page.evaluate(() =>
      ({t: window.__T.g().t, ex: window.__T.g().enemies[0].x}));
    await page.waitForTimeout(1200);
    const frozen = await page.evaluate(() =>
      ({t: window.__T.g().t, ex: window.__T.g().enemies[0].x}));
    expect(frozen.t, '일시정지 중 게임 시간이 흘러선 안 됨').toBe(snap.t);
    expect(frozen.ex, '일시정지 중 적이 움직여선 안 됨').toBe(snap.ex);
    await page.keyboard.press('p');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__T.g().enemies[0].x),
      '재개 후 적이 접근해야 함').toBeLessThan(snap.ex);
  });

  test('F-06 자석 — 필드 젬 전량 진공 흡수 (v0.9 회귀)', async ({ page }) => {
    await startTestGame(page);
    await page.evaluate(() => {
      const p = window.__T.player();
      window.__T.dropGem(p.x + 250, p.y, 1);
      window.__T.dropGem(p.x - 250, p.y, 1);
      window.__T.dropGem(p.x, p.y + 250, 1);
      window.__T.dropGem(p.x, p.y - 250, 3);
    });
    expect(await page.evaluate(() => window.__T.g().gems.length)).toBe(4);
    await page.evaluate(() => window.__T.giveMagnet());
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => window.__T.g().gems.length),
      '자석 획득 후 잔류 젬이 없어야 함').toBe(0);
    expect(await page.evaluate(() => window.__T.g().items.length),
      '자석 아이템이 소비되어야 함').toBe(0);
  });

  test('F-07 에셋 폴백 — floor.png 로딩 실패 시 크래시 없음', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/floor.png', r => r.abort());   // 로딩 강제 실패
    await page.goto('/index.html?test=1');
    await page.click('#startBtn');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__T.imgs().floor.ready),
      '플로어 이미지는 로딩 실패 상태여야 함').toBe(false);
    // 그리드 폴백으로 여전히 렌더링되는지 (빈 화면 감지)
    const distinct = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 997)
        seen.add(`${d[i]},${d[i+1]},${d[i+2]}`);
      return seen.size;
    });
    expect(distinct).toBeGreaterThan(3);
    expect(errors, '폴백 경로에서 JS 예외가 발생하면 안 됨').toHaveLength(0);
  });

  test('F-08 에셋 규격 계약 — 상태별 스프라이트 치수 일치 (BUG-001 회귀)', async ({ page }) => {
    await page.goto('/index.html?test=1');
    await page.click('#startBtn');
    await page.waitForFunction(() => window.__T.imgs().player_d2.ready);
    const imgs = await page.evaluate(() => window.__T.imgs());
    expect(imgs.player_d1.w, '파손1 폭 불일치').toBe(imgs.player.w);
    expect(imgs.player_d1.h, '파손1 높이 불일치 — BUG-001 유형').toBe(imgs.player.h);
    expect(imgs.player_d2.w, '파손2 폭 불일치').toBe(imgs.player.w);
    expect(imgs.player_d2.h, '파손2 높이 불일치 — BUG-001 유형').toBe(imgs.player.h);
  });
});
