# KIWI TOGETHER 🥝

작은 공처럼 둥근 키위새가 되어 친구들과 협동하는 **2D 실시간 멀티플레이 방탈출 게임**입니다.

### 게임 기능
- 플레이어 닉네임 입력, 5자리 코드로 방 생성/참여 (최대 4명)
- 같은 방 친구들 위치가 실시간으로 동기화됨
- **방별 실시간 채팅** (Enter로 입력, 모바일 채팅 버튼), 키위 머리 위 말풍선
- WASD/방향키, 모바일 터치 조이스틱, `Space`로 삐약 말풍선
- 3개의 협동 퍼즐: 동시에 발판 밟기 / 버튼을 누른 상태에서 열쇠 가져오기 / 상자 2개 옮기기
- 스테이지 자동 진행, 퍼즐 초기화, 3개 방 클리어 화면
- PC와 스마트폰 모두 브라우저에서 실행

### 폴더 구성

```
kiwi-escape/
  server.js      # WebSocket 멀티플레이 서버
  index.html     # 화면, 렌더링, 조작, 채팅
  package.json   # 실행 설정
```

## GitHub + Render 무료 배포 (휴대폰에서도 가능)

1. https://github.com/new 에서 새 저장소를 `kiwi-together`로 만들고 **Private**을 선택할 수 있어요.
2. GitHub 저장소의 **Add file → Upload files**로 `server.js`, `index.html`, `package.json` **세 파일**을 올린 뒤 **Commit changes**를 누르세요. ZIP 파일 자체를 올리는 것이 아니라, 압축을 푼 내용물을 업로드해야 합니다.
3. https://dashboard.render.com/ 에 로그인하고 **New → Web Service**를 누르세요.
4. **Git Provider → GitHub**를 연결한 다음 방금 만든 저장소를 선택하세요. 비공개 저장소라도 Render에 접근 권한을 주면 선택할 수 있어요.
5. 다음처럼 설정합니다.
   - **Language / Runtime:** Node
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type / Plan:** Free (표시되는 경우)
6. **Create Web Service**를 누르고 배포가 완료되면 `https://xxxxx.onrender.com` 주소에 접속합니다.
7. 게임에서 **새 방 만들기** → **초대 링크 복사** → 친구에게 보내면 같은 게임 방에 들어올 수 있습니다.

GitHub 저장소가 **Private**여도 게임 웹페이지는 인터넷에서 접속할 수 있습니다. 단, 방 코드를 아는 사람은 방에 들어올 수 있으니 친구에게만 공유하세요.

## 내 컴퓨터에서 실행

Node.js 20 이상 설치 후 폴더에서:

```
npm install
npm start
```

브라우저에서 `http://localhost:10000` 접속. 다른 기기에서 테스트하려면 Render에 먼저 배포하면 편합니다.

### 유의 사항
- Render 무료 서버는 비활성 상태에서 잠들 수 있으므로 첫 접속이 늦어질 수 있습니다.
- 이 게임의 방, 채팅, 진행 기록은 **서버 메모리**에만 보관합니다. 서버 재시작 시 초기화되며 채팅 기록은 DB에 저장되지 않습니다.
- 무료 Render 단일 인스턴스 기준으로 설계했습니다. 다중 인스턴스 확장 시 공유 상태 서버/데이터베이스가 필요합니다.
- 방 코드는 암호나 계정 인증이 아니므로 민감한 정보는 채팅으로 보내지 마세요.
