import { z } from "zod";
import {
  identifierRuleCreate,
  identifierRuleUpdate,
  issuerCode,
  issuerCreate,
  issuerUpdate,
  registryDelete,
  typeIdentityUpdate,
} from "../../contracts/entity-issuer.ts";
import {
  createEntityIssuer,
  createIdentifierRule,
  deleteEntityIssuer,
  deleteIdentifierRule,
  type EntityIssuerDeps,
  getEntityTypeIdentity,
  listEntityIssuers,
  listIdentifierRules,
  updateEntityIssuer,
  updateEntityTypeIdentity,
  updateIdentifierRule,
} from "../../core/entity-issuers/application.ts";
import { keyedTool, type ToolDef } from "./tools.ts";
export function entityIssuerTools(d: EntityIssuerDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "delete_entity_issuer",
      description: "연결·번호 종류가 전혀 없는 오등록 발급처 삭제. 시스템 발급처·참조된 정의는 삭제 불가.",
      input: registryDelete.extend({ code: issuerCode }),
      destructive: true,
      readOnly: false,
      handler: (i, a) => {
        const { code, ...raw } = i;
        return deleteEntityIssuer(d, a, String(code), raw);
      },
    },
    {
      name: "delete_entity_identifier_rule",
      description: "자료 종류에 연결되지 않은 완전 미사용 번호 종류 삭제. 시스템·연결된 번호 종류는 삭제 불가.",
      input: registryDelete.extend({ rule_id: z.string().uuid() }),
      destructive: true,
      readOnly: false,
      handler: (i, a) => {
        const { rule_id, ...raw } = i;
        return deleteIdentifierRule(d, a, String(rule_id), raw);
      },
    },
    {
      name: "list_entity_issuers",
      description: "현재 공간의 발급처 코드·이름·활성 상태·버전 조회.",
      input: z.strictObject({}),
      readOnly: true,
      handler: (_i, a) => listEntityIssuers(d, a),
    },
    {
      name: "create_entity_issuer",
      description: "불변 ASCII 코드와 표시 이름으로 발급처 생성.",
      input: issuerCreate,
      readOnly: false,
      handler: (i, a) => createEntityIssuer(d, a, i),
    },
    {
      name: "update_entity_issuer",
      description: "발급처 표시 이름·활성 상태 수정. 코드는 불변.",
      input: issuerUpdate.extend({ code: issuerCode }),
      readOnly: false,
      handler: (i, a) => {
        const { code, ...raw } = i;
        return updateEntityIssuer(d, a, String(code), raw);
      },
    },
    {
      name: "list_entity_identifier_rules",
      description: "발급처별 재사용 번호 규칙 조회.",
      input: z.strictObject({ source: issuerCode }),
      readOnly: true,
      handler: (i, a) => listIdentifierRules(d, a, String(i.source)),
    },
    {
      name: "create_entity_identifier_rule",
      description: "외부 발급처의 직접 입력 번호 규칙 생성. API 인증이나 자동 연동은 수행하지 않음.",
      input: identifierRuleCreate.extend({ source: issuerCode }),
      readOnly: false,
      handler: (i, a) => {
        const { source, ...raw } = i;
        return createIdentifierRule(d, a, String(source), raw);
      },
    },
    {
      name: "update_entity_identifier_rule",
      description: "규칙 이름·활성 상태·미참조 번호 의미 수정. 참조된 규칙 의미는 불변.",
      input: identifierRuleUpdate.extend({ rule_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { rule_id, ...raw } = i;
        return updateIdentifierRule(d, a, String(rule_id), raw);
      },
    },
    {
      name: "get_entity_type_identity",
      description: "자료 종류의 번호 라벨·기본 발급처·지원 규칙·독립 버전 조회.",
      input: z.strictObject({ type_id: z.string().uuid() }),
      readOnly: true,
      handler: (i, a) => getEntityTypeIdentity(d, a, String(i.type_id)),
    },
    {
      name: "update_entity_type_identity",
      description: "종류별 식별자 설정 저장. 활성 기본 발급처 필수, 참조된 연결 규칙 교체·제거 불가.",
      input: typeIdentityUpdate.safeExtend({ type_id: z.string().uuid() }),
      readOnly: false,
      handler: (i, a) => {
        const { type_id, ...raw } = i;
        return updateEntityTypeIdentity(d, a, String(type_id), raw);
      },
    },
  ];
  return tools.map((t) => t.readOnly ? t : keyedTool(t));
}
