// rig.js — 인식률 측정 하네스 (합성 제스처)
// 사용: node rig.js /tmp/recognizer.js
// 실제 유저 드로잉의 변동 요인(비율, 꺾임 위치, 기울기, 손떨림, 속도 편차)을
// 시드 고정 난수로 재현해 도형별 500회 인식률 + 혼동 행렬을 출력한다.
// 사용: node recognition_rig.js <게임 index.html 경로>
// 종료 코드: 인식률 목표(bolt/vee/circle ≥ 90%, line ≥ 95%, 상호 오인식 ≤ 2%) 미달 시 1
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const m = html.match(/const sigRecognize = \(\(\) => \{[\s\S]*?\}\)\(\);/);
if (!m){ console.error('인식기 코드를 찾지 못함'); process.exit(2); }
const sigRecognize = eval(m[0].replace('const sigRecognize =', ''));
const THRESHOLD = 0.80;

// 시드 고정 난수 (mulberry32)
let seed = 20260709;
function rnd(){
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const R = (a, b) => a + rnd() * (b - a);

// 꼭짓점 배열 → 손그림 스트로크 (점 밀도/손떨림/기울기 적용)
function stroke(waypoints, jitter = 3, tilt = 0){
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  const pts = [];
  for (let i = 1; i < waypoints.length; i++){
    const a = waypoints[i-1], b = waypoints[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(4, Math.round(segLen / R(6, 14)));   // 속도 편차 = 점 밀도 편차
    for (let j = 0; j < n; j++){
      const t = j / n;
      let x = a.x + (b.x - a.x) * t + R(-jitter, jitter);
      let y = a.y + (b.y - a.y) * t + R(-jitter, jitter);
      pts.push({x: x * cos - y * sin, y: x * sin + y * cos});
    }
  }
  pts.push({...waypoints[waypoints.length - 1]});
  return pts;
}

// ---------- 도형별 합성 생성기 (유저 변동 반영) ----------
const GEN = {
  bolt(){
    // 번개: 폭/높이 비율, 꺾임 위치·되돌림 폭, 기울기 모두 랜덤
    const h = R(70, 130), w = R(25, 70);
    const kickY = h * R(0.35, 0.60);          // 첫 꺾임 높이
    const kickBack = w * R(0.4, 1.0);          // 되돌림 폭
    const mirror = rnd() < 0.5 ? -1 : 1;       // 좌우 반전
    let wp = [
      {x: mirror * w * R(0.6, 1.0), y: 0},
      {x: 0, y: kickY},
      {x: mirror * kickBack, y: kickY - R(0, 8)},
      {x: mirror * -w * R(0.1, 0.4), y: h},
    ];
    if (rnd() < 0.5) wp = wp.reverse();        // 아래→위로 긋는 유저
    return stroke(wp, R(1.5, 4), R(-0.25, 0.25));
  },
  vee(){
    const w = R(60, 110), h = R(50, 100);
    let wp = [{x: 0, y: 0}, {x: w * R(0.4, 0.6), y: h}, {x: w, y: R(-8, 8)}];
    if (rnd() < 0.5) wp = wp.reverse();
    return stroke(wp, R(1.5, 4), R(-0.2, 0.2));
  },
  circle(){
    const rx = R(40, 70), ry = rx * R(0.75, 1.25);
    const sa = R(0, Math.PI * 2), dir = rnd() < 0.5 ? 1 : -1;
    const span = R(Math.PI * 1.8, Math.PI * 2.15);  // 덜 닫히거나 겹치는 원
    const wp = [];
    for (let i = 0; i <= 24; i++){
      const a = sa + dir * span * i / 24;
      wp.push({x: Math.cos(a) * rx, y: Math.sin(a) * ry});
    }
    return stroke(wp, R(1.5, 3.5), 0);
  },
  line(){
    const len = R(60, 140), ang = R(0, Math.PI * 2);
    const wp = [{x: 0, y: 0}, {x: Math.cos(ang) * len, y: Math.sin(ang) * len}];
    return stroke(wp, R(1, 3), 0);
  },
};

// ---------- 측정 ----------
const SHAPES = ['bolt', 'vee', 'circle', 'line'];
const TRIALS = 500;
const GOALS = {bolt: 0.90, vee: 0.90, circle: 0.90, line: 0.95};
const MAX_CONFUSE = 0.02;
const confusion = {};
for (const s of SHAPES) confusion[s] = {bolt: 0, vee: 0, circle: 0, line: 0, MISS: 0};

for (const shape of SHAPES){
  for (let i = 0; i < TRIALS; i++){
    const r = sigRecognize(GEN[shape]());
    const top = r.ok ? r.eligible[0] : null;
    if (!top || top.score < THRESHOLD) confusion[shape].MISS++;
    else confusion[shape][top.shape]++;
  }
}

console.log(`도형별 ${TRIALS}회 · 임계값 ${THRESHOLD}\n`);
console.log('실제\\판정   bolt   vee  circle line   MISS   인식률');
for (const s of SHAPES){
  const c = confusion[s];
  const acc = (c[s] / TRIALS * 100).toFixed(1);
  console.log(
    s.padEnd(10),
    String(c.bolt).padStart(5), String(c.vee).padStart(5),
    String(c.circle).padStart(6), String(c.line).padStart(5),
    String(c.MISS).padStart(6), (acc + '%').padStart(8));
}

let fail = 0;
for (const s of SHAPES){
  const c = confusion[s];
  const acc = c[s] / TRIALS;
  const confuse = (TRIALS - c[s] - c.MISS) / TRIALS;
  if (acc < GOALS[s]){ console.log(`[FAIL] ${s} 인식률 ${(acc*100).toFixed(1)}% < 목표 ${GOALS[s]*100}%`); fail++; }
  if (confuse > MAX_CONFUSE){ console.log(`[FAIL] ${s} 오인식률 ${(confuse*100).toFixed(1)}% > 허용 ${MAX_CONFUSE*100}%`); fail++; }
}
console.log(fail ? `\n검증 실패 ${fail}건` : '\n전체 목표 달성 PASS');
process.exit(fail ? 1 : 0);
