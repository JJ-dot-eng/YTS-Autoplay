# Chrome Web Store 등록 메모

## Languages

- English
- Korean

## 단일 목적

YouTube Shorts 영상이 끝나면 자동으로 다음 Shorts로 넘깁니다.

Automatically advances to the next YouTube Shorts video when the current one ends.

## 짧은 설명

현재 Shorts 영상이 끝나면 다음 YouTube Shorts 영상을 자동으로 재생합니다.

Auto play the next YouTube Shorts video when the current Shorts video ends.

## 자세한 설명 초안

YTS Autoplay는 YouTube Shorts 영상이 끝났을 때 자동으로 다음 Shorts로 넘기는 Chrome 확장프로그램입니다.

YouTube 내부 이동으로 Shorts에 들어가도 작동할 수 있도록 YouTube 페이지에서 로드되며, 이미 열려 있는 YouTube 탭에도 필요한 경우 다시 주입됩니다. 자동 넘김 기능은 Shorts 페이지에서만 실행됩니다. 현재 화면에 보이는 영상의 재생 종료를 감지하고 다음 Shorts로 이동합니다.

확장 아이콘을 눌러 자동 넘김 기능을 켜거나 끌 수 있습니다. 개인정보를 수집하지 않고, 외부 서버로 데이터를 보내지 않습니다.

The extension loads on YouTube pages and can reinject its content script into already-open YouTube tabs so it can detect navigation into Shorts without requiring a refresh. The auto-advance feature only runs on Shorts pages.

You can turn auto advance on or off from the extension popup. The extension does not collect personal data or send data to external servers.

## 개인정보 항목

- 데이터 수집: 없음
- 외부 전송: 없음
- 광고/분석/추적: 없음
- 사용 권한: storage
- storage 사용 목적: 자동 넘김 켜기/끄기 설정 저장
- scripting/webNavigation 사용 목적: YouTube 내부 이동과 이미 열려 있는 YouTube 탭에서 content script 주입 보강

## 심사용 테스트 안내

1. 확장프로그램을 설치합니다.
2. `https://www.youtube.com/shorts/...` 형식의 YouTube Shorts 페이지를 엽니다.
3. Shorts 영상을 끝까지 재생합니다.
4. 영상 종료 후 다음 Shorts로 자동 이동하는지 확인합니다.
5. 확장 아이콘을 눌러 자동 넘김을 끈 뒤, 영상 종료 후 자동 이동하지 않는지 확인합니다.
6. YouTube 홈 또는 검색 페이지에서 Shorts로 이동한 뒤, 새로고침 없이 자동 넘김이 동작하는지 확인합니다.
7. 일반 YouTube 영상 페이지에서는 동작하지 않는지 확인합니다.
