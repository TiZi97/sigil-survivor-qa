---
name: game-qa-suite
description: 데이터 테이블 기반 웹게임(HTML5/JS)의 QA 산출물을 자동 생성하는 스킬. 게임 소스에서 밸런스 명세(spec.json)를 추출하고, DPS/TTK 밸런스 리포트와 불변식 검증, 테스트 케이스 시트(CSV), 스모크 테스트, 버그 리포트를 만든다. 사용자가 게임 QA, 테스트 케이스 작성, 밸런스 검증, 버그 리포트, 회귀 테스트, 스모크 테스트, 수치 검증, "이 게임 QA 해줘", "TC 뽑아줘", "밸런스 확인" 등을 언급하면 반드시 이 스킬을 사용할 것. 게임 빌드가 새 버전으로 업데이트되었을 때의 회귀 검증 요청에도 사용한다.
---

# Game QA Suite

데이터 테이블 기반 웹게임을 대상으로 **"코드가 곧 명세"** 원칙의 QA 파이프라인을 실행한다.
게임 소스의 데이터 테이블(`const WEAPONS = {...}` 등)을 단일 기준으로 삼아,
명세 추출 → 수치 검증 → TC 생성 → 스모크 테스트가 하나의 흐름으로 이어진다.

## 파이프라인

```
게임 소스 (index.html)
   │  ① extract_tables.py      # JS 데이터 테이블 → spec.json
   ▼
spec.json  ──②──▶ balance_report.py   # DPS/TTK 리포트 + 불변식 검사 (FAIL 시 exit 1)
   │
   └──③──▶ gen_testcases.py    # 데이터 기반 TC + 수동 회귀 체크리스트 병합 → CSV
④ smoke.spec.js                # Playwright 스모크 (사용자 로컬/CI에서 실행)
```

## 사용 순서

**1. 명세 추출** — 항상 첫 단계. 소스가 바뀌면 반드시 재실행.
```bash
python3 scripts/extract_tables.py <게임>/index.html -o spec.json
```
- 기본 추출: `WEAPONS, PASSIVES, ENEMIES, DIFFS`. 다른 테이블은 `-t 이름,이름`으로 지정.
- 테이블을 못 찾으면 exit 1 + WARN. 소스에서 테이블명이 바뀌었는지 먼저 확인할 것.

**2. 밸런스 검증**
```bash
python3 scripts/balance_report.py spec.json -o balance_report.md
```
- 무기 레벨별 실효 스탯·DPS, 난이도×적 TTK 매트릭스, 플레이어 생존 여유 계산.
- 불변식(쿨다운 양수, DPS 성장, 해금 체인 유효성, 난이도 단조성, 캐주얼 생존 목표 등)
  위반 시 exit 1. **FAIL이 나오면 사용자에게 위반 항목과 수치 근거를 보고**하고,
  의도된 변경인지 확인한다. 목표치가 다르면 `--player-hp`, `--min-hits-to-die` 조정.

**3. TC 생성**
```bash
python3 scripts/gen_testcases.py spec.json -m assets/manual_cases.json -o testcases.csv
```
- 무기 수치/적 스폰/난이도 해금 TC를 명세에서 자동 생성하고 수동 회귀 목록과 병합.
- 새 버그를 수정했으면 **회귀 TC를 `assets/manual_cases.json`에 추가**해 누적한다.
  (버그 1건 수정 = 회귀 케이스 1건 추가가 기본 규칙)

**4. 스모크 테스트** — 샌드박스에서 브라우저 실행이 불가하면 스크립트를 게임 폴더에
복사해 주고 로컬 실행 방법을 안내한다 (`scripts/smoke.spec.js` 상단 주석 참고).

## 버그 리포트

버그를 발견/수정하면 `references/bug-report-template.md`를 읽고 그 형식으로 작성한다.
심각도와 우선순위를 분리해 판단하고, 원인 분석은 확인된 범위까지만 기술한다.

## 버전 핸드오프 체크리스트

새 버전을 패키징해 전달할 때는 항상:
1. `extract_tables.py` 재실행 → spec.json 버전 필드가 새 버전인지 확인
2. `balance_report.py` 전체 PASS 확인 (의도된 FAIL은 사용자 승인 필요)
3. `gen_testcases.py` 재생성 → 이번 버전 변경점의 회귀 TC 포함 여부 확인
4. 변경점 요약에 "QA 체크 항목" 섹션 포함

## 한계와 확장

- `extract_tables.py`는 리터럴 값(숫자/문자열/불리언/null) 테이블 전용.
  함수 값은 `"<fn>"` 문자열로 보존만 한다 (성장 곡선 함수는 별도 수동 검증).
- 새 무기 타입이 추가되면 `balance_report.py`의 `weapon_dps()`에 DPS 공식을 추가할 것.
