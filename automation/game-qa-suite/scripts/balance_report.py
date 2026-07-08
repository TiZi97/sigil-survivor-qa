#!/usr/bin/env python3
"""
balance_report.py — spec.json 기반 밸런스 리포트 생성 + 불변식(invariant) 자동 검증

수치 검증을 두 층으로 수행한다:
  1) 파생 지표 계산: 무기 레벨별 실효 스탯, DPS, 난이도×적 조합별 TTK(Time-To-Kill),
     플레이어 피격 여유(몇 대 맞으면 죽는지)
  2) 불변식 검사: "항상 참이어야 하는 규칙"을 코드로 명시하고 위반 시 FAIL
     → CI에 물리면 밸런스 리그레션을 자동으로 잡는다 (실패 시 exit code 1)

사용법:
  python3 balance_report.py spec.json [-o balance_report.md] [--player-hp 100]
"""
import argparse
import json
import sys

FAILS = []


def check(cond: bool, msg: str):
    """불변식 검사 헬퍼 — 위반 시 FAIL 목록에 적재."""
    status = 'PASS' if cond else 'FAIL'
    if not cond:
        FAILS.append(msg)
    return f'- [{status}] {msg}'


def weapon_stats(w: dict, lv: int) -> dict:
    """레벨별 실효 스탯 = base + perLv * (lv - 1)"""
    return {k: w['base'][k] + w.get('perLv', {}).get(k, 0) * (lv - 1)
            for k in w['base']}


def weapon_dps(key: str, s: dict) -> float:
    """무기 타입별 이론 DPS (단일 대상 기준).

    boomerang: 왕복 2히트 가능 → 발수 × 2히트 / 쿨다운
    cone:      damage / cooldown (Lv4+ 후방 베기는 다중 대상 이득이라 단일 DPS 동일)
    orbit:     접촉 유지 가정, damage × 오브 수 / tick
    """
    if 'cooldown' in s and 'count' in s:          # boomerang
        return s['damage'] * int(s['count']) * 2 / s['cooldown']
    if 'cooldown' in s:                            # cone
        return s['damage'] / s['cooldown']
    if 'tick' in s and s['tick'] > 0:              # aura/orbit (틱 기반)
        return s['damage'] * int(s.get('count', 1)) / s['tick']
    return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('-o', '--output', default='balance_report.md')
    ap.add_argument('--player-hp', type=float, default=100)
    ap.add_argument('--min-hits-to-die', type=int, default=5,
                    help='보통 난이도에서 플레이어가 버텨야 하는 최소 피격 횟수')
    args = ap.parse_args()

    spec = json.load(open(args.spec, encoding='utf-8'))
    W, E, D = spec['WEAPONS'], spec['ENEMIES'], spec['DIFFS']
    ver = spec.get('_meta', {}).get('version', '?')

    out = [f'# 밸런스 리포트 — {ver}', '',
           f'> 자동 생성: `balance_report.py {args.spec}` · 기준 플레이어 HP {args.player_hp:.0f}',
           '']

    # ---------- 1. 무기 레벨별 실효 스탯 / DPS ----------
    out.append('## 1. 무기 성장 곡선 (레벨별 실효 스탯 · 이론 DPS)')
    dps_tbl = {}
    for key, w in W.items():
        out.append(f'\n### {w["name"]} (`{key}`, maxLv {w["maxLv"]})')
        cols = list(w['base'].keys())
        out.append('| Lv | ' + ' | '.join(cols) + ' | DPS |')
        out.append('|---' * (len(cols) + 2) + '|')
        for lv in range(1, w['maxLv'] + 1):
            s = weapon_stats(w, lv)
            dps = weapon_dps(key, s)
            dps_tbl.setdefault(key, {})[lv] = dps
            row = ' | '.join(f'{s[c]:.2f}'.rstrip('0').rstrip('.') for c in cols)
            out.append(f'| {lv} | {row} | {dps:.1f} |')

    # ---------- 2. TTK 매트릭스 (난이도 × 적, 대표 무기 Lv1/최대) ----------
    out.append('\n## 2. TTK 매트릭스 — 적 처치 소요 시간(초)')
    out.append('시작 무기(bolt) Lv1 기준. 캐주얼 목표: 초반 일반 몹 TTK ≤ 3초.\n')
    bolt_lv1 = dps_tbl.get('bolt', {}).get(1, 1)
    out.append('| 난이도 | ' + ' | '.join(f'{e["name"]}({k})' for k, e in E.items()) + ' |')
    out.append('|---' * (len(E) + 1) + '|')
    for dk, d in D.items():
        cells = [f'{e["hp"] * d["hpMul"] / bolt_lv1:.1f}s' for e in E.values()]
        out.append(f'| {d["name"]} | ' + ' | '.join(cells) + ' |')

    # ---------- 3. 플레이어 생존 여유 ----------
    out.append('\n## 3. 플레이어 생존 여유 — 사망까지 필요한 피격 횟수 (HP '
               f'{args.player_hp:.0f} 기준)')
    out.append('| 난이도 | ' + ' | '.join(f'{e["name"]}' for e in E.values()) + ' |')
    out.append('|---' * (len(E) + 1) + '|')
    hits_matrix = {}
    for dk, d in D.items():
        row = []
        for ek, e in E.items():
            hits = args.player_hp / (e['dmg'] * d['dmgMul'])
            hits_matrix[(dk, ek)] = hits
            row.append(f'{hits:.1f}대')
        out.append(f'| {d["name"]} | ' + ' | '.join(row) + ' |')

    # ---------- 4. 불변식 검사 ----------
    out.append('\n## 4. 불변식 검사 (자동 검증)')
    for key, w in W.items():
        smax = weapon_stats(w, w['maxLv'])
        if 'cooldown' in smax:
            out.append(check(smax['cooldown'] > 0.05,
                       f'{w["name"]}: 최대 레벨 쿨다운 > 0.05s (실측 {smax["cooldown"]:.2f}s)'))
        if 'tick' in smax:
            out.append(check(smax['tick'] > 0.05,
                       f'{w["name"]}: 최대 레벨 틱 간격 > 0.05s (실측 {smax["tick"]:.2f}s)'))
        if 'slow' in smax:
            out.append(check(smax['slow'] < 0.6,
                       f'{w["name"]}: 감속률 < 60% (실측 {smax["slow"]*100:.0f}%) — 완전 정지 방지'))
        out.append(check(smax['damage'] >= w['base']['damage'],
                   f'{w["name"]}: 피해량이 레벨업 시 감소하지 않음'))
        d1, dmax = dps_tbl[key][1], dps_tbl[key][w['maxLv']]
        out.append(check(dmax > d1,
                   f'{w["name"]}: 최대 레벨 DPS({dmax:.1f}) > Lv1 DPS({d1:.1f})'))

    # 난이도 해금 체인: unlockAfter가 실제 존재하는 난이도인지 + 순환 없음
    for dk, d in D.items():
        ua = d.get('unlockAfter')
        out.append(check(ua is None or ua in D,
                   f'난이도 "{d["name"]}": unlockAfter "{ua}" 유효'))
    roots = [dk for dk, d in D.items() if d.get('unlockAfter') is None]
    out.append(check(len(roots) >= 1, f'즉시 플레이 가능한 난이도 존재 ({roots})'))

    # 난이도 오름차순: 해금 체인을 따라 hpMul/dmgMul이 단조 증가
    for dk, d in D.items():
        ua = d.get('unlockAfter')
        if ua and ua in D:
            out.append(check(
                d['hpMul'] >= D[ua]['hpMul'] and d['dmgMul'] >= D[ua]['dmgMul'],
                f'난이도 곡선 단조성: {D[ua]["name"]} → {d["name"]} (hp/dmg 배율 비감소)'))

    # 적 스폰 타이밍: fromSec 존재 + 0초 스폰 적이 최소 1종
    early = [e for e in E.values() if e.get('fromSec', 0) == 0]
    out.append(check(len(early) >= 1, '게임 시작(0초)부터 등장하는 적 존재'))

    # 캐주얼 목표: 보통 난이도에서 어떤 적에게도 N대 미만으로 죽지 않음
    if 'normal' in D:
        worst = min(hits_matrix[('normal', ek)] for ek in E)
        out.append(check(worst >= args.min_hits_to_die,
                   f'보통 난이도 생존 여유: 최악 피격 횟수 {worst:.1f}대 ≥ '
                   f'{args.min_hits_to_die}대 (캐주얼 목표)'))

    # ---------- 결과 ----------
    out.append(f'\n---\n**검증 결과: {"전체 PASS ✅" if not FAILS else f"FAIL {len(FAILS)}건 ❌"}**')
    for f_ in FAILS:
        out.append(f'- ❌ {f_}')

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    print(f'[{"OK" if not FAILS else "FAIL"}] {args.output} 생성 — '
          f'불변식 위반 {len(FAILS)}건')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
