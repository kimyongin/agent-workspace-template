# 워크스페이스 초대 메일 전달

초대 저장과 메일 전달은 별도로 확인한다. 초대 생성은 비공개 전달 대기 항목을 같은 트랜잭션에 저장한다. 내부 `invitation-mail-worker`를 실행하면 현재 공간·초대한 관리자의 권한·초대 유효 상태를 확인하고 한 항목을 전달한다. 주기 실행이나 배포를 자동으로 추가하지 않는다.

## 전달 상태

`pending`은 대기 또는 진행 중, `sent`는 공급자의 요청 접수다. 받은 편지함 도착을 뜻하지 않는다. `failed`는 확정된 거절, `unknown`은 전송 결과 불명, `unconfigured`는 전달 설정이 없거나 사용할 수 없는 상태다. 관리자만 현재 초대 버전을 지정해 재시도한다. 같은 논리 요청의 재확인은 기존 요청 키와 입력을 유지한다.

공급자로 보낼 메시지와 멱등 키는 실제 통신 전에 저장한다. Resend의 키 보관은 24시간이며 앱의 30일 요청 결과 보관과 다르다. 결과 불명 재시도는 같은 메시지·키로 최초 전송 가능 시점부터 23시간 59분까지 허용해 통신 시간을 확보한다. Mailpit에는 같은 중복 방지 보장을 가정하지 않으며 결과 불명 재전송을 거절한다. 만료된 진행 작업도 결과 불명으로 처리하며 자동 재발송하지 않는다. [Resend 공식 계약](https://resend.com/docs/dashboard/emails/idempotency-keys)을 기준으로 한다.

## 실행 구성

함수는 기존 `PROCESSING_TOKEN`과 `WORKER_DB_URL`을 사용한다. 사용자 HTTP/MCP 토큰으로는 호출할 수 없다. `POST /functions/v1/invitation-mail-worker`에 `{}` 또는 `{"limit":1}`을 보낸다. `{"check_configuration":true}`는 DB 연결·큐 소비·메일 전송 없이 `delivery_configured`를 확인한다. 토큰·DB 주소·공급자 키를 로그나 응답에 출력하지 않는다.

외부 전달은 다음 서버 환경 값으로 명시한다. 실제 키 설정과 외부 발송은 별도의 실행 범위다.

| 값 | 의미 |
| --- | --- |
| `INVITATION_MAIL_MODE=resend` | Resend 전달 선택 |
| `RESEND_API_KEY` | 서버 전용 키 |
| `INVITATION_MAIL_FROM` | 발송자 이메일 주소 하나 |
| `INVITATION_WEB_ORIGIN` | 초대 수락 화면의 HTTPS origin 하나. 경로·질의·사용자 정보는 허용하지 않음 |

Resend 목적지는 `https://api.resend.com/emails`로 고정하며 redirect를 따라가지 않는다. 이 설정이 없다는 이유로 실제 발송을 완료했다고 보고하지 않는다.

## 격리 로컬 전달

로컬 확인은 [Mailpit HTTP Send API](https://mailpit.axllent.org/docs/usage/sending-messages/)만 사용한다. Mailpit에 SMTP 전달·외부 relay를 구성하지 않는다. 별도 공개 SMTP 포트를 만들 필요가 없으며 HTTP 포트는 loopback에만 공개한다. 기존의 다른 작업이 사용하는 Mailpit·포트·메시지는 건드리지 않는다.

`INVITATION_MAIL_MODE=mailpit`과 발송자·웹 origin을 지정하고 `INVITATION_MAILPIT_ORIGIN`에 로컬 sink의 HTTP origin 하나를 설정한다. 호스트에서 실행하는 DB worker 검사는 `http://127.0.0.1:<port>`를 사용한다. 로컬 Edge 함수는 Docker 컨테이너 안에서 실행되므로 `127.0.0.1`이 호스트를 뜻하지 않는다. 이 경로에서는 `http://host.docker.internal:<port>`를 사용한다. 이 고정 호스트 별칭은 **명시적 Mailpit 모드의 서버 sink 설정에만** 허용하며 임의 사설 호스트·원격 호스트·하위 도메인·경로·인증 정보를 허용하지 않는다. 웹 origin에는 이 별칭을 허용하지 않는다. 로컬 웹 origin은 loopback HTTP도 허용한다.

호스트용 DB 검사와 Edge 함수의 환경 설정은 서로 다른 sink 주소를 사용할 수 있다. 준비한 격리 환경에서 먼저 설정 확인을 실행하고, 실제 초대 작성 → worker 처리 → 초대 목록의 전달 상태와 해당 수신자의 Mailpit 내용 확인을 구분해 기록한다. 로컬 성공은 외부 이메일 발송이나 받은 편지함 도착의 증거가 아니다. worker가 사용하는 주소를 브라우저나 요청 본문에서 받지 않는다.

`supabase/tests/database/workspace-invitation-delivery.test.ts`의 기본 검사는 실제 DB 권한·원장·lease 경계를 확인한다. `INVITATION_MAILPIT_ORIGIN`을 설정한 경우 추가 검사는 해당 로컬 sink로 메시지 하나를 보내고, 자신이 만든 고유 수신자 메시지 ID만 삭제한다. 실제 Edge 함수 진입점의 내부 인증·전달 검증은 별도로 실행한다.
