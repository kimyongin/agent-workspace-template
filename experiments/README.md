# 기술 실험

앱 코드를 쓰기 전에 되돌리기 비싼 기술 가정을 작게 시험하는 폴더다. 여기 있는 코드는 앱이 가져오지 않고 배포하지 않는다. 규칙은 [개발 방법의 기술 실험](../docs/development/workflow.md#기술-실험)을 따른다.

| 폴더 | 목적 | 결과 | 상태 |
| --- | --- | --- | --- |
| [t02-1](t02-1/README.md) | 직접 Postgres 트랜잭션의 Actor 문맥·RLS·큐 원자성, MCP OAuth와 토큰 audience 구분 | [T02-1 실험 결과](../docs/tickets/template-02-t02-1-contracts.md#실험-결과-작업-9) | 로컬 실험 완료. 호스팅 동작은 운영 배포 후 확인, 외부 클라이언트는 T02-4에서 확인 |
| [t02-3-embedding](t02-3-embedding/README.md) | 한국어 관련·무관·본문 전용 질문, 입력 경계·절단 거부, 모델·차원·cosine 임계값 | [Template-02 T02-3](../docs/tickets/template-02-implementation-base.md#t02-3--사용자-원칙rag지식-연결) | 실제 모델 평가 완료, 새 도메인은 자료 교체 후 재평가 |
| [agent-model-evaluation](agent-model-evaluation/README.md) | 동일 offline 구현·권한/일관성 리뷰, native child·동일 설정 resume와 노출 사용량 | [Template-10-05](../docs/tickets/template-10-05-model-execution-evaluation.md) | 두 CLI balanced 대표 과제·부모 resume 확인; Codex custom child·backend effort·실제 청구액 미확인 |

새 실험은 `experiments/<주제>/`를 만들고 README와 이 표의 행을 함께 추가한다. 실험은 지우지 않으며, 결과가 더 이상 맞지 않으면 상태를 `대체됨`으로 바꾸고 대체한 실험을 링크한다.
