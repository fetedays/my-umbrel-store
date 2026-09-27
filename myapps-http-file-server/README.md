# HTTP File Server (UmbrelOS 커스텀 앱)

폴더를 HTTP로 공개해 Galaxy Home Mini 같은 기기에서 바로 재생할 수 있게 해주는
초경량 파일 서버입니다.

## 포함된 파일
- `umbrel-app.yml` : Umbrel 앱 매니페스트
- `docker-compose.yml` : 컨테이너 정의 (8080 포트 직접 노출)
- `Dockerfile` / `server.js` / `package.json` : 실제 서버 코드 (Node.js + Express)

## 설치 방법 (커뮤니티 앱스토어 방식)

이 폴더(`myapps-http-file-server`)는 이미 `my-umbrel-store` 저장소 구조 안에
올바른 이름으로 들어가 있습니다. 그대로 GitHub에 올리기만 하면 됩니다.
자세한 순서는 저장소 최상위의 `README-등록방법.md`를 참고하세요.

> Umbrel이 기기에서 직접 `docker compose build`를 수행하므로, 별도로 Docker
> 이미지를 미리 만들어 올리지 않아도 됩니다. (기기가 인터넷에서 npm 패키지를
> 받을 수 있어야 합니다.)

## 공유할 폴더 지정하기 (중요)

**방법 A: Umbrel의 "고급 폴더 접근" 기능 사용 (권장)**

Umbrel 앱 상세 화면 → "내 폴더에 접근" → "고급 폴더 접근"에서 폴더를 추가할 수 있습니다.
이때 **"앱 서비스 내부 경로"에 반드시 `/data/media/원하는이름` 형식으로 입력**하세요.
(`/media`처럼 입력하면 이 앱이 그 경로를 보지 못합니다. 꼭 `/data/media/`로 시작해야 합니다.)

예: NAS의 다운로드 폴더를 공유하고 싶다면 `/data/media/downloads`라고 입력하고
왼쪽에서 실제 호스트 폴더를 선택한 뒤 "폴더 추가"를 누르세요.

**방법 B: docker-compose.yml 직접 수정 (고급 사용자용)**

Docker 컨테이너는 미리 마운트해 둔 경로만 접근할 수 있습니다. 그래서
`docker-compose.yml`의 `volumes` 항목에서, 왼쪽(호스트 실제 경로)을
원하는 폴더로 바꿔주세요.

```yaml
volumes:
  - ${APP_DATA_DIR}/config:/data/config
  - ${APP_DATA_DIR}/media:/data/media/local

  # NAS를 이미 Umbrel 서버(리눅스)에 마운트해 두었다면:
  - /mnt/nas/music:/data/media/nas-music:ro

  # 외장 USB 드라이브 예시:
  - /media/umbrel/usb1:/data/media/usb1:ro
```

- 오른쪽 경로는 항상 `/data/media/무언가` 형태로 맞춰주세요.
- 여러 개를 원하는 만큼 추가할 수 있습니다.
- **NAS 자체를 마운트하는 작업은 이 앱이 하지 않습니다.** Umbrel 호스트
  OS(리눅스) 수준에서 먼저 `mount -t cifs ...` 등으로 마운트되어 있어야
  하고, 이 앱은 그렇게 이미 마운트된 경로를 컨테이너 안으로 다시 연결(bind)
  할 뿐입니다.

수정 후 Umbrel 앱을 재시작(또는 재설치)하면 반영됩니다.

## 사용 방법

1. `http://umbrel.local:8080` (또는 `http://<서버IP>:8080`) 접속
2. `/data/media` 아래에 폴더가 **정확히 하나뿐**이면 자동으로 그 폴더가
   공유 루트로 설정됩니다. 폴더가 여러 개거나 직접 고르고 싶으면,
   `/_ui` 페이지(예쁜 화면)에서 "⚙ 공유 루트 변경" 버튼으로 원하는 폴더에
   들어간 뒤 "✅ 이 폴더를 공유 루트로 설정"을 누르세요.
3. 이후 그 폴더 기준으로 하위 폴더 탐색, mp3 재생(▶), 다운로드(⬇),
   URL 복사(🔗)를 사용할 수 있습니다.

> `/` (루트 주소)는 Galaxy Home Mini 같은 기기가 이해할 수 있도록 순수
> HTML 목록으로 응답합니다. 사람이 보기 좋은 화면은 `/_ui`에 있고,
> `/`에서도 우측 상단 "🎨 예쁜 화면으로 보기" 링크로 이동할 수 있습니다.

## Galaxy Home Mini 재생용 URL

공유 루트를 예를 들어 `nas-music`으로 설정했고, 그 안에 `001.mp3`가 있다면:

```
http://192.168.1.230:8080/001.mp3
```

하위 폴더가 있다면:

```
http://192.168.1.230:8080/앨범1/001.mp3
```

HTTP `Range` 요청을 지원하므로 이어재생/구간 탐색도 정상 동작합니다.

## 보안 참고

- 이 앱은 **인증이 없습니다.** 같은 홈 네트워크 안에서, Galaxy Home Mini처럼
  로그인 절차를 거치기 어려운 기기를 위한 용도로 만들었습니다.
- 외부(인터넷)에 8080 포트를 포트포워딩하지 마세요. 집 안에서만 쓰는 걸
  권장합니다.
