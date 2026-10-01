# ADR-0002: 기본 기술 구성

- 상태: 채택 (소급 기록)
- 날짜: 2026-10-01

## 배경

새 도메인 앱을 빠르게 시작하려면 서버·DB·인증·검색의 기본 선택이 정해져 있어야 한다. 운영 부담과 공급자 수는 적게 유지한다.

## 결정

| 영역 | 기본 선택 |
| --- | --- |
| 웹 배포 | GitHub Pages (정적 빌드) |
| 서버·DB·큐·세션 | Supabase (Postgres, Edge Functions, Auth, Queues/pgmq, Cron) |
| 사용자 로그인 | Supabase Auth의 Google OAuth |
| 임베딩 생성 | Pinecone Inference (벡터 인덱스는 사용하지 않음) |
| 벡터 저장·검색 | Supabase Postgres의 pgvector |
| 서버 언어 | TypeScript |

구체적인 모델·차원·런타임 버전·SQL 드라이버는 구현 티켓에서 검증 후 정하며 이 ADR의 변경이 아니다. Storage·Realtime은 실제 요구가 생길 때 추가한다.

## 결과

- 서버 기능을 Supabase 하나에 모아 운영할 수 있다. 임베딩 때문에 외부 공급자 하나(Pinecone)와 그 키·데이터 전송 검토가 추가된다.
- 공급자를 바꾸면 이 ADR을 대체하는 새 ADR과 함께 설정·배포·운영 문서를 갱신한다.

## 관련 문서

- [아키텍처](../architecture/hexagonal-review.md), [배포 방법](../deployment/release.md)
