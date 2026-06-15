# YTS Autoplay

YouTube Shorts 영상이 한 번 끝나면 자동으로 다음 Shorts로 넘기는 Chrome 확장프로그램입니다.

## 설치 방법

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 프로젝트 폴더를 선택합니다.
5. `https://www.youtube.com/shorts/...` 주소에서 Shorts를 재생해 확인합니다.

## 동작 방식

- YouTube Shorts 페이지에서만 실행됩니다.
- 현재 화면에 보이는 Shorts 영상이 끝나면 다음 Shorts로 이동합니다.
- 다음 버튼을 찾지 못하면 화면을 아래로 스크롤해 다음 Shorts로 넘깁니다.

## 권한

별도 권한은 사용하지 않습니다. content script도 `https://www.youtube.com/shorts/*`에서만 실행됩니다.

## 개발 및 배포 전 확인

```powershell
npm.cmd run check
```

배포 ZIP을 만들 때는 아래 명령을 사용합니다.

```powershell
npm.cmd run package
```

생성된 ZIP은 `dist/` 폴더에 저장됩니다. Chrome Web Store에 올릴 때는 ZIP 안의 최상위 위치에 `manifest.json`이 있어야 합니다.

## Chrome Web Store 준비 메모

- `STORE_LISTING.md`에 등록 문구와 심사용 테스트 안내를 정리했습니다.
- `PRIVACY.md`에 개인정보 처리 안내를 정리했습니다.
- 배포 전에는 실제 YouTube Shorts 페이지에서 영상 종료 후 한 번만 다음 Shorts로 넘어가는지 확인해야 합니다.
