#!/usr/bin/env python3
"""
extract_tables.py — 게임 소스(index.html)에서 데이터 테이블을 추출해 spec.json 생성

데이터 테이블 기반(data-driven) HTML5 게임에서 `const NAME = { ... };` 형태의
JS 객체 리터럴을 찾아 JSON 명세로 변환한다. "코드가 곧 명세"라는 전제 하에,
이 spec.json이 이후 밸런스 검증(balance_report.py)과 TC 생성(gen_testcases.py)의
단일 기준(single source of truth)이 된다.

사용법:
  python3 extract_tables.py <index.html 경로> [-t 테이블명,테이블명...] [-o spec.json]

기본 추출 대상: WEAPONS, PASSIVES, ENEMIES, DIFFS
"""
import argparse
import json
import re
import sys

DEFAULT_TABLES = ['WEAPONS', 'PASSIVES', 'ENEMIES', 'DIFFS']


def find_object_literal(src: str, name: str) -> str | None:
    """`const NAME = {` 부터 중괄호 짝이 맞는 지점까지 원문 추출."""
    m = re.search(rf'const\s+{name}\s*=\s*\{{', src)
    if not m:
        return None
    start = m.end() - 1          # '{' 위치
    depth, i = 0, start
    in_str = None
    while i < len(src):
        c = src[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
        elif c in ('"', "'", '`'):
            in_str = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[start:i + 1]
        i += 1
    return None


def js_object_to_json(js: str) -> dict:
    """JS 객체 리터럴 → JSON 변환 (리터럴 값 전용: 숫자/문자열/불리언/null).

    함수(화살표 함수 등)가 값으로 있으면 문자열 "<fn>"으로 치환해 보존한다.
    """
    s = js
    s = re.sub(r'//[^\n]*', '', s)                    # 한 줄 주석 제거
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)       # 블록 주석 제거
    # 화살표 함수 값 → "<fn>" (예: `xpNeed: lv => 5 + ...,`)
    s = re.sub(r':\s*[\w(),\s]*=>[^,}\n]*', ': "<fn>"', s)
    # 키 따옴표 처리 (unquoted key → "key")
    s = re.sub(r'([{,]\s*)([A-Za-z_$][\w$]*)\s*:', r'\1"\2":', s)
    # 작은따옴표 문자열 → 큰따옴표 (내부 큰따옴표 이스케이프)
    s = re.sub(r"'((?:[^'\\]|\\.)*)'",
               lambda m: json.dumps(m.group(1).replace('\\\'', '\'')), s)
    s = re.sub(r',\s*([}\]])', r'\1', s)              # 트레일링 콤마 제거
    return json.loads(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source', help='게임 소스 파일 (index.html 등)')
    ap.add_argument('-t', '--tables', default=','.join(DEFAULT_TABLES),
                    help='추출할 테이블명 (콤마 구분)')
    ap.add_argument('-o', '--output', default='spec.json')
    args = ap.parse_args()

    with open(args.source, encoding='utf-8') as f:
        src = f.read()

    # 버전 문자열도 함께 기록 (명세-빌드 추적성)
    ver = re.search(r'PROTOTYPE\s+(v[\d.]+)', src)
    spec = {'_meta': {'source': args.source,
                      'version': ver.group(1) if ver else 'unknown'}}

    missing = []
    for name in args.tables.split(','):
        name = name.strip()
        raw = find_object_literal(src, name)
        if raw is None:
            missing.append(name)
            continue
        try:
            spec[name] = js_object_to_json(raw)
        except json.JSONDecodeError as e:
            print(f'[ERROR] {name} 파싱 실패: {e}', file=sys.stderr)
            sys.exit(2)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)

    print(f'[OK] {args.output} 생성 — 테이블 {len(spec) - 1}개, '
          f'버전 {spec["_meta"]["version"]}')
    if missing:
        print(f'[WARN] 미발견 테이블: {", ".join(missing)}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
