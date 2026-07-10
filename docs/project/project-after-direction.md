# YTS Autoplay 구현 후 방향

## 0.6.2 - Shorts 자동 넘김 안정화

### 수정 이유

0.6.1은 실제 영상 종료뿐 아니라 영상이 같은 URL에서 0초로 반복되는 경우까지 대응했지만, 수동 되감기 오인, 느린 SPA 전환 중 재클릭, 설정 초기 읽기 전 동작, 일반 YouTube 페이지의 상시 감시와 기능 테스트 부재가 남아 있었다.

### 실제 변경 방향

- 종료 판정의 순수 로직을 `content-logic.js`로 분리했다.
- 자연 반복은 이전 재생 위치가 실제 종료 구간 안이고, duration이 유지되며, 탐색 중이 아닐 때만 인정한다.
- `seeking`과 `seeked`에서 관찰 진행을 초기화해 사용자 탐색을 자연 반복으로 오인하지 않게 했다.
- 이동 성공은 URL의 Short ID 변경으로만 확정한다.
- URL 갱신 전에 video 노드나 소스가 바뀌면 즉시 재클릭하지 않고 새 영상 진행 상태를 다시 준비한다.
- 새 Short ID가 먼저 반영되고 이전 ended video가 잠시 남아 있어도 두 번째 이동을 실행하지 않는다.
- 이동 버튼이나 다음 renderer가 늦게 나타나는 경우 제한된 탐색 재시도를 수행한다.
- 다음 버튼 탐색은 활성 renderer와 해당 Shorts 컨테이너 안으로 제한하고, 다음 renderer 또는 Shorts 내부 스크롤 컨테이너만 대체 경로로 사용한다.
- 저장 설정을 확인하기 전에는 기능을 시작하지 않고, 설정 읽기 실패 시 안전하게 꺼짐으로 처리한다.
- MutationObserver와 100ms/500ms 타이머는 기능이 켜진 유효한 Shorts 페이지에서만 생성하며, 비활성화·페이지 이탈·컨트롤러 교체 시 모두 정리한다.
- 같은 버전 재주입은 기존 controller를 새로 만들지 않고 갱신하며, 오래된 확장 컨텍스트의 정리 예외가 새 주입을 막지 않게 했다.
- popup은 로딩·저장·실패 상태를 표시하고, 저장 실패 시 이전 값으로 복원한다. 스위치의 고정 이름과 상태 설명도 분리했다.
- Manifest와 package 버전 일치, Chrome 확장 버전 형식, ZIP 파일 목록·SHA-256·내부 버전을 자동 검증한다.
- 버전을 `0.6.2`로 올리고 `content-logic.js`를 선언형·동적 주입 및 배포 ZIP에 포함했다.

### 영향받은 파일

- 런타임: `content.js`, `content-logic.js`, `background.js`, `manifest.json`
- 설정 UI: `popup.html`, `popup.css`, `popup.js`, `_locales/en/messages.json`, `_locales/ko/messages.json`
- 검증·배포: `package.json`, `tools/validate-extension.mjs`, `tools/package-extension.ps1`, `tools/verify-package.ps1`
- 테스트: `tests/content-logic.test.cjs`, `tests/content-runtime.test.cjs`, `tests/popup.test.cjs`
- 문서: `STORE_LISTING.md`, `docs/project/project-direction.md`, `docs/project/project-after-direction.md`

### 검증 결과

- `npm.cmd run test`: 34개 통과, 실패 0개
- `npm.cmd run check`: 통과 (`extension validation ok`)
- `npm.cmd run package`: 통과
- `dist/yts-autoplay-v0.6.2.zip`: 원본과 SHA-256이 일치하는 13개 런타임 파일, 내부 Manifest `0.6.2`
- Playwright Chromium에 unpacked extension으로 로드해 실제 YouTube Shorts 자연 종료를 확인했다.
  - `/shorts/kz1rplr5MvU`에서 `/shorts/VewoC_B2_EQ`로 자동 이동
  - 새 영상은 약 `0.005초`, 재생 중 상태로 시작
  - 전환 직후 같은 Short ID가 유지되어 연속 건너뛰기가 없음을 확인
- popup에서 자동 넘김을 끄면 종료 이벤트에도 URL이 유지되고, 다시 켜면 다음 Short ID로 이동하는 것을 확인했다.

### 계획과 달라진 점

초기 계획은 video 노드나 소스 변경 뒤 추가 유예 시간을 두고 재시도하는 방식이었다. 실제 구현에서는 URL 갱신이 매우 늦을 때 새 영상을 다시 클릭해 건너뛸 수 있으므로, 미디어가 바뀐 경우 재클릭하지 않고 진행 판정을 다시 준비하는 더 보수적인 방향을 선택했다.
