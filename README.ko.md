<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark</h1>

<p align="center">로컬 우선 WYSIWYG Markdown 데스크톱 에디터</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.es.md">Español</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/tauri-2-FFC131.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/version-4.0.0-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark 메인 화면: 왼쪽 아웃라인 패널, 오른쪽 WYSIWYG 편집 영역">
</p>

---

## 소개

ArborMark(중국어 이름: 简筑)는 **Electron**과 자체 리치 텍스트 렌더링 엔진으로 만든 독립형 데스크톱 Markdown 에디터입니다.

Markdown의 간결함과 리치 텍스트의 직관성을 한 화면에 담았습니다. 입력하는 동안 즉시 렌더링되고, 필요할 때 단축키 한 번으로 소스 모드로 전환할 수 있습니다. 문서는 항상 표준 `.md` 파일로 로컬에 저장되며, 전용 형식이나 계정, 클라우드에 의존하지 않습니다.

- 저장소: <https://github.com/Arbor4/ArborMark>
- 이슈: <https://github.com/Arbor4/ArborMark/issues>
- 다운로드: <https://github.com/Arbor4/ArborMark/releases>

## 기능

| 기능 | 설명 |
| :--- | :--- |
| 실시간 미리보기 | 입력과 동시에 렌더링하며, 현재 블록의 Markdown 소스를 볼 수 있음 |
| 소스 모드 | 일반 텍스트 편집으로 전환해 Markdown을 정교하게 수정 |
| 아웃라인과 파일 트리 | 제목 아웃라인, 폴더 트리, 목록 보기, 전체 검색 |
| 확장 문법 | 표, 할 일 목록, 각주, YAML Front Matter, 위첨자/아래첨자, 형광펜 |
| 수식 | MathJax 기반 인라인/블록 LaTeX, 자동 번호 매기기 지원 |
| 다이어그램 | Mermaid(순서도, 시퀀스, 클래스, 상태, 간트, 파이), Flowchart.js, Sequence |
| 이미지 | 드래그 앤 드롭, 상대 경로, 지정 폴더로 복사, 이미지 호스팅 업로드 |
| 가져오기/내보내기 | PDF, HTML, 이미지, Pandoc 기반 Word / EPUB / LaTeX |
| 테마 | 여러 내장 테마. macOS 기본값은 **Liquid Glass** |
| 다국어 | 40개 언어. 시스템 언어를 따르거나 직접 선택 |
| 안전한 저장 | 자동 저장, 비정상 종료 복구, 저장하지 않은 초안 복구 |
| 명령줄 | 명령줄에서 파일이나 폴더 열기 |

## 다운로드 및 설치

[Releases](https://github.com/Arbor4/ArborMark/releases)에서 플랫폼별 설치 파일을 받으세요.

- macOS: `.dmg` / `.zip`
- Windows: NSIS 설치 프로그램 / 포터블 `.zip`
- Linux: `.AppImage` / `.deb`

macOS에서 처음 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안**에서 허용하세요.

## 개발

### 요구 사항

- Node.js **20+**
- npm 10+
- macOS / Windows / Linux

### 실행

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install
npm run build
npm start
```

개발 모드(페이지와 런타임을 빌드한 뒤 Electron 실행):

```bash
npm run dev
```

설치 파일을 만들려면:

```bash
npm run dist:mac
```

### 테스트

```bash
# 단위 테스트 + 통합 테스트
npm test

# E2E 테스트(데스크톱 환경 필요)
npm run test:e2e
```

### 패키징

```bash
npm run dist:mac     # macOS dmg / zip
npm run dist:win     # Windows nsis / zip
npm run dist:linux   # Linux AppImage / deb
```

> 변경할 때마다 패키징할 필요는 없습니다. `npm start`로 최신 소스를 바로 불러올 수 있습니다.

## 프로젝트 구조

```text
ArborMark/
├── src/
│   ├── main/                  # Electron 메인 프로세스(창, 메뉴, IPC, 프로토콜, 저장)
│   ├── preload/               # 컨텍스트 격리와 안전한 브리지
│   ├── renderer/
│   │   ├── core/              # 에디터 코어, 선택 영역, 실행 취소/다시 실행
│   │   ├── block/             # 코드 블록, 표, 수식, 다이어그램, 이미지
│   │   ├── markdown/          # Markdown 파싱과 직렬화
│   │   ├── io/                # 파일, 내보내기, 클립보드, Pandoc
│   │   ├── ui/                # 메뉴, 사이드바, 아웃라인, 검색, 파일 트리
│   │   ├── pages/             # React 환경 설정·환영·라이선스 페이지
│   │   ├── vendor/            # 서드파티 런타임(CodeMirror, jQuery, Rangy 등)
│   │   └── static/            # 호스트 HTML, 테마, 내장 문서, 아이콘
│   └── shared/                # 메인과 렌더러가 공유하는 상수
├── tools/                     # 빌드와 테스트 스크립트
├── test/                      # 단위, 통합, E2E 테스트
├── resources/                 # 앱 아이콘과 설치 파일 자산
└── docs/                      # 아키텍처와 서드파티 문서
```

자세한 모듈 구성은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.

## 설계 노트

- **로컬 우선**: 문서, 이미지, 테마, 설정은 기본적으로 로컬에 저장됩니다.
- **일반 텍스트**: 모든 내용을 표준 Markdown으로 저장해 다른 에디터에서도 열 수 있습니다.
- **테마 확장**: 테마는 일반 CSS 파일이며, 사용자 테마 폴더에 넣으면 자동으로 인식됩니다.
- **안전한 경계**: 렌더러에는 최소한의 preload API만 노출하고, 외부 링크는 프로토콜 허용 목록을 거칩니다.
- **유지보수성**: 메인, 렌더러, 공유 계층을 분리하고 핵심 동작에 회귀 테스트를 둡니다.

앱의 **도움말 → Markdown 기능 예제**에서 전체 문법 예제를 열 수 있습니다. 원본 파일은 [Markdown Demo.md](src/web/src/bridge/demo/markdown-full-demo.md)입니다.

## 기여

이슈와 Pull Request를 환영합니다.

1. 저장소를 Fork하고 `feat/your-feature` 또는 `fix/your-fix` 브랜치를 만듭니다.
2. 제출 전에 관련 테스트를 실행합니다: `node tools/run-tests.mjs test/unit/<test>.test.mjs`
3. 커밋 메시지는 의미 있는 형식을 사용합니다:
   - `feat(editor): 코드 블록 언어 추가`
   - `fix(export): PDF 내보내기 이미지 누락 수정`
4. PR에 변경 내용, 테스트 방법, UI 변경 시 스크린샷을 포함하세요.

기여를 제출하면 프로젝트의 오픈소스 라이선스로 배포하는 데 동의한 것으로 간주합니다.

## 라이선스

ArborMark는 **GNU General Public License v3.0 or later(GPL-3.0-or-later)** 로 배포됩니다.

다음을 자유롭게 할 수 있습니다.

- 프로젝트 사용, 복사, 수정
- 수정한 버전 배포
- 상업적 사용

단, copyleft 조건에 따라 **파생 저작물을 배포할 때는 GPL-3.0-or-later로 공개하고 전체 소스 코드를 제공해야 합니다**. 본 소프트웨어는 어떠한 보증도 없이 제공됩니다.

전문은 [LICENSE](LICENSE)를 참고하세요.

> GPL-3.0을 선택한 이유: 완성된 데스크톱 애플리케이션에 적합한 성숙한 강한 copyleft 라이선스입니다. 포함된 MIT / Apache-2.0 구성 요소와 호환되며, 파생 버전이 비공개로 재배포되는 것을 막을 수 있습니다.

## 서드파티 컴포넌트

다음 오픈소스 프로젝트를 사용합니다.

- [Electron](https://www.electronjs.org/) (MIT)
- [CodeMirror](https://codemirror.net/5/) (MIT)
- [MathJax](https://www.mathjax.org/) (Apache-2.0)
- [Mermaid](https://mermaid.js.org/) (MIT)
- [jQuery](https://jquery.com/) (MIT)
- [Rangy](https://github.com/timdown/rangy) (MIT)
- [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)
- [React](https://react.dev/) (MIT)

전체 저작권 및 라이선스 정보는 앱의 **도움말 → 크레딧**과 각 의존성의 LICENSE 파일을 참고하세요.

## 면책 조항

ArborMark는 독립적인 오픈소스 프로젝트이며, 어떤 상업용 Markdown 에디터와도 제휴, 승인, 후원 관계가 없습니다. 프로젝트 이름, 아이콘, UI 자산은 원작이거나 허가를 받아 사용했습니다. 서드파티 구성 요소의 저작권은 각 저자에게 있습니다.

권리 침해가 있다고 생각되면 [Issues](https://github.com/Arbor4/ArborMark/issues)로 알려 주세요.

---

Copyright © 2026 Arbor · ArborMark contributors
