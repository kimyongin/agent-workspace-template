# 기술 실험

제품의 되돌리기 비싼 기술 가정을 격리해 확인하는 자료다. 앱이 이 폴더의 코드를 가져오거나 배포하지 않는다. 설계 질문을 시험하는 방법은 [prototype 스킬](../.agents/skills/prototype/SKILL.md)이 담당한다.

| 실험 | 제품의 검증 경계 | 채택 기준·근거 |
| --- | --- | --- |
| [t02-1](t02-1/README.md) | Postgres 트랜잭션의 Actor 문맥·RLS·큐 원자성, MCP OAuth와 audience 구분 | [아키텍처](../docs/architecture/hexagonal-review.md) |
| [t02-3-embedding](t02-3-embedding/README.md) | 한국어 관련·무관·본문 전용 질문, 입력 경계, 모델·차원·cosine 임계값 | [검색 설계](../docs/architecture/search.md), 폴더의 실제 평가 결과 |
| [plugin-behavior](plugin-behavior/README.md) | 제품 스킬의 두 CLI 선택·실제 MCP 조회/저장·업데이트 | [제품 플러그인](../plugins/workspace/README.md), [#122](https://github.com/kimyongin/agent-workspace-template/issues/122)의 현재 검증 |

| [agent-efficiency](agent-efficiency/README.md) | 같은 요청·revision·시작 조건의 문맥·호출·완료 결과 비교 | [#277](https://github.com/kimyongin/agent-workspace-template/issues/277); 정적 inventory와 실제 작업 계측을 구분 |

실험 결과는 당시의 소스·환경에 한정된다. 제품의 현재 동작이나 운영 적용 완료는 해당 구현과 GitHub 증거에서 확인한다.
