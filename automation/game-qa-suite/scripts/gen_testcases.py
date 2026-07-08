#!/usr/bin/env python3
"""
gen_testcases.py — spec.json에서 테스트 케이스 시트(CSV) 자동 생성

데이터 테이블이 곧 명세이므로, 명세의 각 항목에서 기계적으로 검증 가능한
TC를 생성한다. 여기에 수동 회귀 체크리스트(assets/manual_cases.json)를
병합해 전체 테스트 스위트를 구성한다.

TC 필드: ID, 분류, 우선순위, 제목, 사전조건, 재현 스텝, 기대 결과, 검증 방법
  - 검증 방법: AUTO(스크립트 검증 가능) / MANUAL(수동 플레이 필요)

사용법:
  python3 gen_testcases.py spec.json [-m manual_cases.json] [-o testcases.csv]
"""
import argparse
import csv
import json


def weapon_stats(w, lv):
    return {k: w['base'][k] + w.get('perLv', {}).get(k, 0) * (lv - 1)
            for k in w['base']}


def fmt(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('-m', '--manual', default=None,
                    help='수동 TC 시드 파일 (JSON)')
    ap.add_argument('-o', '--output', default='testcases.csv')
    args = ap.parse_args()

    spec = json.load(open(args.spec, encoding='utf-8'))
    rows, n = [], 0

    def add(cat, pri, title, pre, steps, expect, method):
        nonlocal n
        n += 1
        rows.append({
            'ID': f'TC-{n:03d}', '분류': cat, '우선순위': pri, '제목': title,
            '사전조건': pre, '재현 스텝': steps, '기대 결과': expect,
            '검증 방법': method,
        })

    # ---------- 무기: 레벨별 수치 검증 ----------
    for key, w in spec.get('WEAPONS', {}).items():
        for lv in range(1, w['maxLv'] + 1):
            s = weapon_stats(w, lv)
            expect = ', '.join(f'{k}={fmt(v)}' for k, v in s.items())
            add('무기 수치', 'P1',
                f'{w["name"]} Lv{lv} 실효 스탯 검증',
                f'{w["name"]} Lv{lv} 보유 상태',
                'spec.json 기준 base+perLv 계산값과 인게임 동작 대조',
                expect, 'AUTO')
        add('무기 기능', 'P1',
            f'{w["name"]} 최대 레벨({w["maxLv"]}) 초과 업그레이드 미노출',
            f'{w["name"]} Lv{w["maxLv"]} 보유', '레벨업 3회 반복하며 선택지 확인',
            f'{w["name"]} 카드가 선택지에 등장하지 않음', 'MANUAL')

    # ---------- 적: 등장 타이밍/수치 ----------
    for key, e in spec.get('ENEMIES', {}).items():
        add('적 스폰', 'P1',
            f'{e["name"]}({key}) 최초 등장 시점 검증',
            '보통 난이도 새 게임',
            f'생존 타이머 {e.get("fromSec", 0)}초 전후 스폰 관찰',
            f'{e.get("fromSec", 0)}초 이전 미등장, 이후 등장. '
            f'HP {e["hp"]}, 접촉 피해 {e["dmg"]}', 'MANUAL')

    # ---------- 난이도: 해금/배율 ----------
    for dk, d in spec.get('DIFFS', {}).items():
        ua = d.get('unlockAfter')
        if ua:
            ua_name = spec['DIFFS'][ua]['name']
            add('난이도 해금', 'P0',
                f'"{d["name"]}" 해금 조건 검증',
                f'클리어 기록 없는 새 브라우저 프로필',
                f'1) 잠금 상태 확인 2) "{ua_name}" 보스 처치(클리어) 3) 로비 복귀',
                f'클리어 전 선택 불가, "{ua_name}" 클리어 후 즉시 해금', 'MANUAL')
        add('난이도 배율', 'P1',
            f'"{d["name"]}" 배율 적용 검증',
            f'"{d["name"]}" 새 게임',
            '초반 적 처치 소요 타격 수 / 피격 피해량 측정',
            f'적 HP ×{d["hpMul"]}, 적 피해 ×{d["dmgMul"]}, '
            f'점수 ×{d["scoreMul"]}', 'MANUAL')

    # ---------- 수동 회귀 체크리스트 병합 ----------
    if args.manual:
        for c in json.load(open(args.manual, encoding='utf-8')):
            add(c['분류'], c['우선순위'], c['제목'], c.get('사전조건', '-'),
                c['재현 스텝'], c['기대 결과'], c.get('검증 방법', 'MANUAL'))

    with open(args.output, 'w', encoding='utf-8-sig', newline='') as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)

    auto = sum(1 for r in rows if r['검증 방법'] == 'AUTO')
    print(f'[OK] {args.output} 생성 — 총 {len(rows)}건 '
          f'(AUTO {auto} / MANUAL {len(rows) - auto})')


if __name__ == '__main__':
    main()
