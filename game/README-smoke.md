# 스모크 테스트 실행법

이 폴더에서:

```
npm install                        # 최초 1회
npx playwright install chromium    # 최초 1회
npm test                           # 실행 (서버 자동 기동/종료)
npm run report                     # HTML 리포트 열기
```

5개 테스트(SMK-01~05)가 약 20초간 돌고, 장면별 스크린샷이
`screenshots/`에 저장된다. 상세 검증 내용은 smoke.spec.js 상단 주석 참고.
