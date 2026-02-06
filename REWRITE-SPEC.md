# Open Smart Connections — Phase 1 Rewrite Spec

## 1. Overview

**목표**: Open Smart Connections 플러그인의 UI/UX를 Obsidian 네이티브 API 기반으로 전면 리라이트하여, Connections View가 10,000개 노트 규모의 vault에서 안정적으로 동작하도록 한다.

**핵심 원칙**:
- SmartEnv는 **데이터 레이어로만** 사용 (embedding, vector storage, collection 관리)
- **모든 UI는 Obsidian 네이티브 API** (Setting, ItemView, Modal, Notice)로 구현
- Metadata Auto Classifier의 Obsidian API 활용 패턴 참고
- Phase 1은 **Connections View + 로컬 임베딩** 동작에만 집중

---

## 2. Phase 1 성공 기준

- [ ] 노트를 열면 Connections View 사이드 패널에 유사 노트 목록이 표시된다
- [ ] 벡터가 없는 노트는 자동으로 임베딩이 시작되고 로딩 상태가 표시된다
- [ ] 로컬 모델(transformers.js, bge-micro-v2)로 임베딩이 정상 동작한다
- [ ] 10,000개 노트의 초기 임베딩 시 백그라운드 처리 + 진행률 패널이 동작한다
- [ ] 결과 항목에 마우스를 올리면 Obsidian 네이티브 호버 프리뷰가 표시된다
- [ ] 설정 탭이 계층적 그룹으로 구성되어 가독성이 높다
- [ ] hot-reload로 개발/검증이 가능하다

---

## 3. 아키텍처

### 3.1 레이어 분리

```
┌─────────────────────────────────────┐
│          Obsidian Plugin API         │
│  (ItemView, SettingTab, Notice, ...)│
├─────────────────────────────────────┤
│         UI Layer (새로 작성)          │
│  - ConnectionsView (ItemView)       │
│  - SettingsTab (PluginSettingTab)    │
│  - EmbeddingProgressPanel           │
├─────────────────────────────────────┤
│         Bridge Layer (최소 수정)      │
│  - SmartEnv config 읽기/쓰기        │
│  - entity.vec 접근                   │
│  - entity.find_connections() 호출    │
│  - collection.lookup() 호출          │
│  - embed queue 상태 모니터링         │
├─────────────────────────────────────┤
│         Data Layer (유지)            │
│  - SmartEnv (embedding, storage)    │
│  - smart_sources collection         │
│  - smart_blocks collection          │
│  - transformers.js adapter          │
└─────────────────────────────────────┘
```

### 3.2 SmartEnv 의존 범위

**유지하는 것:**
- `SmartEnv.create()` — 환경 초기화
- `env.smart_sources` — 소스 컬렉션 접근
- `entity.vec` — 벡터 존재 여부 확인
- `entity.find_connections()` — 유사 노트 검색
- `process_embed_queue` — 임베딩 큐 처리
- `.smart-env/` 저장소 — 벡터 데이터 영속화

**제거/우회하는 것:**
- SmartEnv의 컴포넌트 렌더링 시스템 (`components/` 등록)
- SmartEnv의 설정 UI 렌더링
- SmartNotice.js (Obsidian Notice로 교체)
- SmartEnv의 뷰 관리 로직

---

## 4. 삭제 대상 (데드코드 정리)

Phase 1에서 Connections View만 집중하므로 아래 기능/파일을 **제거**:

| 기능 | 대상 파일 |
|------|-----------|
| Chat (스마트 채팅) | `views/smart_chat.obsidian.js`, `views/smart_chat.js`, `views/sc_chatgpt.obsidian.js` |
| Lookup (시맨틱 검색) | `views/sc_lookup.obsidian.js`, `components/lookup.js` |
| Bases 연동 | `bases/cos_sim.js`, `bases/connections_score_column.js`, `bases/connections_score_column_modal.js` |
| Code Block 렌더링 | `utils/build_connections_codeblock.js`, `render_code_block()` in index.js |
| Release Notes | `views/release_notes_view.js` |
| Random Connection | `utils/get_random_connection.js` |
| Banner | `utils/banner.js` |
| SmartNotice | `utils/SmartNotice.js` |
| Deep Proxy (설정용) | `utils/create_deep_proxy.js` |
| 기존 컴포넌트 | `components/connections.js`, `components/connections_result.js`, `components/connections_results.js`, `components/main_settings.js` |
| 기존 뷰 | `views/sc_connections.obsidian.js` |
| 기존 모달 | `modals/connections_filter.js` |

---

## 5. UI 설계

### 5.1 Connections View (ItemView)

**파일**: `src/views/ConnectionsView.ts` (또는 .js)

**동작 플로우**:
```
노트 열림 (file-open event)
    ↓
SmartEnv에서 entity 조회
    ↓
entity.vec 존재?
  ├─ Yes → find_connections() 호출 → 결과 목록 렌더링
  └─ No  → 자동 임베딩 시작 + 로딩 스피너 표시
              ↓
           임베딩 완료 → find_connections() → 결과 목록 렌더링
```

**결과 항목 UI**:
- 각 항목: `[유사도 점수] 노트 이름` (한 줄)
- 클릭 → 해당 노트로 이동
- 마우스 호버 → Obsidian 네이티브 호버 프리뷰 (workspace.trigger('hover-link', ...))
- 컨텍스트 메뉴: 새 탭에서 열기, 분할 열기, 링크 복사
- 드래그앤드롭: 위키링크로 드래그 가능

**상태 표시 (View 내부 인라인)**:
- 임베딩 중: 스피너 + "임베딩 중..." 텍스트
- 임베딩 에러: 에러 메시지 + 재시도 버튼
- 연결 없음: "유사한 노트를 찾을 수 없습니다"
- 전체 임베딩 진행 중: 진행률 바 (N/전체)

### 5.2 Settings Tab (PluginSettingTab)

**파일**: `src/settings/SettingsTab.ts` (또는 .js)

**계층적 그룹 구조**:
```
[Smart Connections Settings]
├── Embedding Model
│   ├── Model: bge-micro-v2 (드롭다운, 향후 확장)
│   └── Status: "Ready" / "Loading model..."
│
├── Source Settings
│   ├── Minimum characters: 200 (숫자 입력)
│   ├── File exclusions: (텍스트 입력)
│   ├── Folder exclusions: (텍스트 입력)
│   └── Excluded headings: (텍스트 입력)
│
├── Block Settings
│   ├── Enable block-level embedding: (토글)
│   └── Minimum block characters: 200 (숫자 입력)
│
├── View Settings
│   ├── Results limit: 20 (숫자 입력)
│   ├── Show full path: (토글)
│   ├── Exclude inlinks: (토글)
│   ├── Exclude outlinks: (토글)
│   └── Render markdown in preview: (토글)
│
└── Embedding Status
    ├── Total sources: N
    ├── Embedded: N
    ├── Pending: N
    └── [Re-embed All] 버튼
```

**구현 방식**: Obsidian `Setting` API 사용
- `new Setting(containerEl).setName().setDesc().addDropdown()` 패턴
- `setHeading()`으로 그룹 구분
- 설정값은 SmartEnv config에서 읽고, 변경 시 SmartEnv config에 쓰기

### 5.3 Embedding Progress Panel

**위치**: Connections View 상단 또는 별도 상태 영역

**표시 내용**:
- 전체 노트 수 / 임베딩 완료 수
- 프로그레스 바 (시각적)
- 현재 처리 중인 노트 이름
- 예상 남은 시간 (선택적)
- [일시정지] / [재개] 버튼

### 5.4 에러/알림

- `new Notice("메시지")` — Obsidian 네이티브 Notice API 직접 사용
- 에러 시 명확한 메시지 + 가능한 액션 안내
- "muted notice" 개념 제거 — 모든 알림은 동등하게 표시

---

## 6. 구현 접근 방식

### 6.1 점진적 교체

현재 코드베이스 위에서 하나씩 교체. 빌드가 항상 동작하는 상태 유지.

**순서**:
1. 데드코드 제거 (Chat, Lookup, Bases, CodeBlock 등)
2. 기존 components/, views/ 제거
3. 새 ConnectionsView 작성 (Obsidian ItemView)
4. 새 SettingsTab 작성 (Obsidian PluginSettingTab)
5. index.js 정리 (새 뷰/설정 등록, 불필요한 커맨드 제거)
6. SmartEnv config 정리 (UI 컴포넌트 등록 제거)
7. 임베딩 진행률 UI 추가
8. 통합 테스트 (hot-reload + CDP)

### 6.2 각 단계마다

- 빌드 확인 (`npm run build`)
- hot-reload로 Obsidian에서 동작 확인
- 커밋

---

## 7. 기술 결정 요약

| 항목 | 결정 |
|------|------|
| 플러그인 | Open Smart Connections (기존 upstream과 별개) |
| UI 프레임워크 | Obsidian 네이티브 API (vanilla JS/TS) |
| 데이터 레이어 | SmartEnv 유지 (embedding, vector storage) |
| 설정 UI | Obsidian SettingTab + Setting API, 계층적 그룹화 |
| 임베딩 모델 | Local transformers.js (bge-micro-v2) MVP |
| 벡터 저장소 | SmartEnv 내부 저장소 (.smart-env/) |
| 결과 상호작용 | 호버 프리뷰 중심, 클릭으로 이동 |
| 에러 알림 | Obsidian Notice API 직접 사용 |
| 기타 기능 | 제거 (Chat, Lookup, Bases, CodeBlock, etc.) |
| 리라이트 방식 | 점진적 교체 (빌드 유지) |
| 테스트 | 수동 (hot-reload + CDP), 단위 테스트는 Phase 2 |
| Vault 규모 | 10,000개 노트 대응 (백그라운드 임베딩 + 진행률) |

---

## 8. Phase 2 (향후)

- 외부 임베딩 모델 지원 (OpenAI, Ollama 어댑터)
- Lookup (시맨틱 검색) 기능 재구현
- 단위 테스트 커버리지 확보
- 성능 최적화 (대규모 vault 인덱싱 속도)
- 설정 마법사 (초기 설정 온보딩)

---

## 9. 참고 사항

- Metadata Auto Classifier의 Obsidian API 활용 패턴 참고 (`/Users/beomsu/Documents/GitHub/Obsidian/Metadata-Auto-Classifier/`)
- SmartEnv의 설정값 구조는 `smart_env.config.js`에서 확인
- 현재 뷰 타입: `smart-connections-view`, `smart-connections-chat`, `smart-connections-chatgpt`, `smart-connections-lookup`
- Phase 1 후에는 `smart-connections-view`만 유지
