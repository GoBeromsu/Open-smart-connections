# Reader-Mutator 분리 — 문제 정의 문서

> **작성일**: 2026-04-20
> **범위**: 문제 정의 전용. 해결 아키텍처는 별도 설계 문서에서 다룬다.
> **프로젝트**: open-connections (Obsidian 플러그인, TypeScript)

---

## 1. 문서 목적 및 범위

이 문서는 open-connections 플러그인의 현재 아키텍처적 문제를 정의하는 것만을 목적으로 한다. 오늘 브레인스토밍 세션에서 도출된 원칙, 증상, 근본 원인, 그리고 자기 철학 문서와의 괴리를 기록한다.

**이 문서가 다루지 않는 것**: 구체적인 구현 전략, 클래스 설계, 파일 배치 결정. 그런 내용은 후속 설계 문서(Reader-Mutator Split Design)에서 다룬다.

**배경**: 저자는 15,000개 이상의 노트를 보유한 볼트에서 이 플러그인을 사용한다. 임베딩 기반 의미론적 검색(Transformers.js)은 규모가 커질수록 현재 아키텍처의 결함이 UX 문제로 직결된다.

---

## 2. 브레인스토밍 여정 요약

오늘 세션은 다음 열 단계를 거쳐 문제의 핵심에 도달했다.

1. **초기 진단**: 파일 전환 시 네비게이션 랙(주 증상)과 콜드 스타트 시 빈 화면(부 증상) 확인.
2. **첫 번째 재프레이밍**: "프로파일링이 잘 안 되는 게 문제가 아니라, 경로 자체가 너무 복잡한 게 문제." 측정 불가능함은 결과이지 원인이 아니다.
3. **제약 명시**: 15K+ 노트 사용자도 느리지 않게. 기능을 붙일 때마다 누적된 "좋을 것 같아서 붙인 것들"이 UX를 갉아먹고 있다.
4. **멘탈 모델 확립**: I(Input trigger) → P(Process embed) → O(Output view). 현재 코드는 이 경계를 지키지 않는다.
5. **13초 디바운스 재검토**: 시간 기반 재계산은 불필요하다. 재계산은 파일을 열 때 그 순간 수행되어야 한다.
6. **핵심 돌파구**: "Read와 Write를 구분하지 않은 것이 문제." 이것이 오늘 세션의 중심 테제다.
7. **iframe 오해 수정**: iframe/Worker는 스케줄링 문제를 해결하는 수단이 아니라 CPU 오프로드 수단이다. 오늘의 문제는 스케줄링이 아니라 책임 분리다.
8. **패턴 탐색**: CQRS, Repository, Event-sourced Mutator를 검토하고, Repository + Reactive Store를 최소 실현 방안으로 선택했다.
9. **Writer 배치 후보 탐색**: domain/ 신규 클래스, EmbeddingKernelJobQueue 승격, ui/ 파사드. 아직 미결.
10. **메타 돌파구**: 사용자가 직관적으로 표현한 한국어 문장들이 오래된 소프트웨어 원칙과 정확히 대응됨을 확인. 이것이 오늘 세션의 수확이다.

---

## 3. 대원칙 (Grand Principles)

브레인스토밍 과정에서 사용자가 직접 표현한 문장들은 다음의 소프트웨어 원칙과 대응된다.

| 사용자의 표현 | 원칙 | 출처 |
|---|---|---|
| "읽기와 쓰기를 분리하라" | Command-Query Separation (CQS) | Bertrand Meyer, 1988 — *Object-Oriented Software Construction* |
| "공통의 타입으로 대화를 주고받아야" | Dependency Inversion Principle (DIP) | Robert C. Martin — SOLID의 D |
| "API가 명시적으로 묶여야" | Design by Contract | Meyer — Eiffel 언어 설계 원칙 |
| "한 곳만 읽게 만들자" | Single Source of Truth + Information Hiding | David Parnas, 1972 — "On the Criteria To Be Used in Decomposing Systems into Modules" |
| "fan-out이 쉽도록 구조적으로" | Open/Closed Principle + Interface Segregation | SOLID의 O, I |

**메타 원칙**: 모듈은 구현이 아니라 계약(타입)을 통해 대화한다.

**Meyer의 CQS 한 줄 요약**: *"Asking a question should not change the answer."*

이 다섯 원칙은 독립적으로 존재하지 않는다. CQS 위반은 DIP 위반을 유발하고, DIP 위반은 계약을 불분명하게 만들며, 불분명한 계약은 단일 진실 공급원을 파괴한다. 현재 코드베이스에서 이 연쇄가 실제로 관찰된다.

---

## 4. 현재 증상

### 4.1 파일 전환 랙

파일을 전환할 때 ConnectionsView가 눈에 띄게 지연된다. 사용자가 다른 노트로 이동하는 행위 자체가 무거운 연산을 동기적으로 촉발하기 때문이다. 15K+ 노트 볼트에서 이 랙은 명확하게 체감된다.

### 4.2 콜드 스타트 빈 화면

플러그인을 처음 로드하거나 새 파일을 열 때 ConnectionsView가 빈 상태로 나타났다가 데이터가 채워지는 흐름이 발생한다. 이전 결과를 재사용(stale-while-revalidate)하는 대신, 매번 초기화 후 재진입하는 구조이기 때문이다.

이 두 증상은 서로 다른 버그가 아니다. 동일한 근본 원인의 두 가지 표현이다.

---

## 5. 근본 원인: 원칙별 위반 증거

### 5.1 CQS 위반 — 읽기 작업이 상태를 변경한다

**`src/ui/connections-view-state.ts:34-39`**

`deriveConnectionsViewState()`는 이름부터 Query다. 호출자는 현재 상태를 읽어오는 것으로 기대한다. 그러나 내부에서 `import_source_blocks()`와 `data_adapter.save()`를 실행한다. 즉, 상태를 읽는 함수 안에서 Command가 실행된다. Meyer의 경고 그대로다: "답을 묻는 행위가 답을 바꿔버린다."

**`src/domain/semantic-search.ts:88`**

평균 벡터를 계산하는 코드 직후에 `evictVec(id)`를 호출한다. 벡터를 읽으러 갔더니 벡터가 사라지는 구조다. 읽기와 쓰기(상태 변경)가 한 흐름 안에 묶여 있어, 같은 입력으로 두 번 호출했을 때 결과가 달라진다.

### 5.2 DIP 위반 — 고수준 모듈이 구체 구현에 직접 의존한다

**`ConnectionsView` → `block_collection.for_source()` 직접 호출**

`ConnectionsView`는 고수준 UI 컴포넌트다. `BlockReader` 같은 추상화 없이 `block_collection`의 구체 구현을 직접 호출한다. 이로 인해 테스트에서 목킹이 불가능하고, `block_collection` 구현을 교체할 때 뷰 코드도 함께 수정해야 한다.

**`src/main.ts:92-117`**

`SmartConnectionsPlugin` 클래스가 God Object로 자라났다. `block_collection`, `source_collection`, `embedding_job_queue`, `pendingReImportPaths`, `_embed_state`, `_embed_profiling`, `embed_adapter`, `_search_embed_model` 등 15개 이상의 내부 상태가 public 필드로 노출되어 있다. 어떤 collaborator든 이 필드를 직접 건드릴 수 있으며, 실제로 여러 곳에서 그렇게 하고 있다. 의존 방향이 역전되어 있지 않고, 모든 것이 중심 오브젝트에 결합되어 있다.

### 5.3 Design by Contract 위반 — 계약이 명시되어 있지 않다

**`for_source()`의 빈 배열 반환 조건 미명시**

`for_source()`가 언제 빈 배열을 반환하는지에 대한 명시적 계약이 없다. 인덱스가 아직 안 만들어진 경우인가, 파일이 존재하지 않는 경우인가, 아니면 임베딩이 진행 중인 경우인가. 모든 호출자가 이 empty-case를 각자 다르게 추측하며 방어 코드를 작성한다.

**Dirty 상태가 4곳에 흩어져 있다**

"이 파일은 재임베딩이 필요하다"는 사실을 나타내는 상태가 네 곳에 분산되어 있다.

- `pendingReImportPaths` — `main.ts:112`
- Block 엔티티의 `queue_embed` 플래그
- `EmbeddingKernelJobQueue` 내부 큐
- `file-watcher.ts`의 13초 `setTimeout` 타이머

어느 것이 권위 있는 진실인지 알 수 없다. 네 곳이 모두 조금씩 다른 dirty 개념을 추적하고 있으며, 통일된 계약이 없다.

### 5.4 Information Hiding 위반 — 내부 구현이 외부에 노출된다

**Plugin 필드가 public으로 노출**

`SmartConnectionsPlugin`의 내부 상태가 public 필드로 선언되어 있어 어떤 외부 코드든 직접 읽고 쓸 수 있다. 캡슐화가 없는 상태다.

**`src/ui/ConnectionsView.ts:66-94`**

`ConnectionsView`(Read-side 소비자)가 8개의 workspace 이벤트를 직접 구독한다: `file-open`, `active-leaf-change`, `embed-state-changed`, `embed-progress` 등. Write-side에서 발생하는 이벤트들이 Read-side 뷰 컴포넌트로 직접 누수된다. 읽기 컴포넌트가 쓰기 사이드의 내부 진행 상황을 알아야 하는 구조는 정보 은닉의 반대다.

### 5.5 OCP/ISP 위반 — 변경이 넓게 전파된다

**`BlockCollection` 교체 비용**

`BlockCollection`을 다른 구현으로 교체하려면 약 27개의 호출 지점을 수정해야 한다(추정). 좁은 인터페이스가 존재하지 않기 때문에 변경의 fan-out이 코드베이스 전체로 퍼진다. 이것은 OCP(변경에 닫혀 있어야 한다)와 ISP(불필요한 메서드에 의존하지 않아야 한다) 모두를 위반하는 결과다.

---

## 6. 왜 지금까지 못 고쳤나 — Pessimism Budget 누적

각각의 "빨간 화살표"는 개별적으로는 합리적인 결정이었다. 문제는 합산이다.

| 코드 패턴 | 원래 의도 |
|---|---|
| `evictVec()` | 메모리 위생 — 벡터 캐시 무한 증가 방지 |
| `setTimeout(0)` yield (`flat-vector-index.ts`) | 협력적 스케줄링 — 메인 스레드 블로킹 방지 |
| `container.empty()` | 방어적 DOM 리셋 — 이전 렌더 잔여물 제거 |
| 13초 debounce | Burst 방지 — 잦은 저장 시 임베딩 폭발 억제 |
| inline `import_source_blocks` | Lazy import — 불필요한 선행 로딩 회피 |
| `autoQueueBlockEmbedding` | Self-healing — 인덱스 불일치 자동 복구 |

각 레이어가 독립적으로 비관(pessimism) 예산을 소비했다. "이 경우엔 문제가 생길 수 있으니 방어 코드를 추가하자"는 판단이 여섯 번 쌓이면서, 합산 결과가 UX 하락으로 나타났다. 특히 blank-then-refill 패턴은 이 방어들이 겹쳐진 결과다: `container.empty()`로 지우고, lazy import를 기다리고, setTimeout yield로 스케줄을 넘기고, 다시 채우는 과정이 사용자 눈에는 빈 화면으로 보인다.

---

## 7. 자기 철학 문서와의 괴리

`docs/embedding-pipeline-philosophy.md`는 현재 코드가 지향해야 할 방향을 이미 명시했다. 그러나 현재 구현은 그 철학을 세 가지 규칙에서 위반한다.

### Rule 5 위반 — Stale-While-Revalidate 미구현

**철학 문서의 명시**: "Connections View should focus on results and, at most, a lightweight qualitative notice such as 'index updating' or 'results may be stale'."

**현재 구현**: blank-then-refill. 재계산이 필요할 때 뷰를 완전히 비웠다가 다시 채운다. 철학 문서가 명시적으로 기술한 stale-while-revalidate 패턴이 구현되어 있지 않다.

### Rule 4 위반 — 진행 상황 표면이 3곳으로 분산

**철학 문서의 명시**: "One authoritative progress surface."

**현재 구현**: 진행 상황을 표시하는 UI 표면이 세 곳에 존재한다. Settings 화면, Status bar, ConnectionsView 배너. 어느 것이 권위 있는 표면인지 사용자도 개발자도 알 수 없다.

### Rule 8 위반 — 관찰 가능성 미구현

**철학 문서의 명시**: 큐 깊이, 경과 시간, 저장 케이던스, UI 교체 횟수를 관찰해야 한다.

**현재 구현**: 이 지표들 중 어느 것도 측정되지 않는다. 철학 문서가 "측정해야 할 것"으로 명시한 항목이 구현 안 됨 상태다.

이 세 가지 괴리는 철학 문서가 나쁘게 작성된 것이 아님을 의미한다. 방향은 이미 맞게 설정되어 있었다. 구현이 철학을 따라가지 못한 것이다.

---

## 8. 오늘 합의된 것 / 미결 사항

### 합의된 것

**멘탈 모델**: Read/Write 분리가 대원칙이다. ConnectionsView는 읽기만, Mutator는 쓰기만 담당한다.

**가장 작은 오늘의 slice**: stale-while-revalidate. ConnectionsView에서 blank 화면을 없애는 것이 첫 번째 체감 가능한 개선이다.

**설계 패턴**: Repository + Reactive Store. CQS + DIP + Information Hiding의 최소 구현으로, 과도한 CQRS 인프라 없이 원칙을 실현하는 방안이다.

**4-slice 로드맵**:
1. Stale-while-revalidate — ConnectionsView blank 제거
2. Reader-Mutator interface 분리 — CQS + DIP 원칙 구조화
3. DirtyRegistry + demand-driven — 13초 debounce 제거, 단일 dirty 진실 공급원
4. Optional Web Worker — CPU 오프로드 (스케줄링이 아닌 연산 부담 감소)

### 미결 사항

**Writer 배치**: Mutator(Writer)를 어디에 둘 것인가. 세 가지 후보가 있다.
- `domain/` 디렉터리에 신규 클래스로 추가
- 기존 `EmbeddingKernelJobQueue`를 승격하여 Writer 역할 부여
- `ui/` 파사드로 배치

각 후보의 트레이드오프는 설계 문서에서 다룬다.

**Updating-indicator UX 강도**: 재계산 중임을 사용자에게 얼마나 강하게 알릴 것인가. 세 가지 옵션이 있다.
- 무표시 (완전한 stale-while-revalidate, 사용자는 결과만 본다)
- 얇은 상단 로딩 바
- 개별 결과 카드를 dim 처리

**ViewState 타입의 `types/` 이동 범위**: 현재 ViewState 관련 타입이 어디까지 `types/` 디렉터리로 이동해야 하는지.

---

## 9. 다음 단계

이 문서는 문제 정의에서 멈춘다. 다음 단계는 별도의 설계 문서를 작성하는 것이다.

**후속 문서**: `2026-04-20-reader-mutator-split-design.md`

설계 문서에서 다룰 내용: Reader interface 정의, Mutator(Writer) 배치 결정, DirtyRegistry 설계, Reactive Store 선택, 4-slice 구현 순서의 구체화.

---

## 10. 문서 자기 검토

이 문서는 **문제 정의 전용**이다.

포함된 것:
- 오늘 브레인스토밍에서 도출된 원칙과 그 출처
- 현재 코드에서 원칙이 위반된 증거 (file:line)
- 위반이 발생하게 된 역사적 맥락 (pessimism budget)
- 철학 문서와의 괴리
- 합의된 방향과 미결 사항

포함되지 않은 것:
- 구체적인 클래스 설계나 인터페이스 정의
- 파일 배치 결정
- 구현 코드 스니펫
- 단계별 구현 지시사항

해결 아키텍처는 이 문서를 기반으로 작성될 별도의 설계 문서에서 다룬다.
