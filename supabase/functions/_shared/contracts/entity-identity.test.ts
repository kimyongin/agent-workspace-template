import { assertEquals } from "@std/assert";
import { resolvedBusinessSettings } from "./business-settings.ts";

Deno.test("기존 UUID 발급 설정을 짧은 식별자 발급으로 읽는다", () => {
  const legacy = JSON.parse(
    '{"entity_identity":{"generation":"uuid","default_source":"app","sources":[{"code":"app","label":"앱"}]}}',
  );
  assertEquals(resolvedBusinessSettings(legacy).entity_identity?.generation, "short");
});

Deno.test("발급처 순서가 기본 선택을 정하고 각 발급 방식은 독립적이다", () => {
  const settings = resolvedBusinessSettings({
    entity_identity: {
      generation: "short",
      default_source: "app",
      sources: [{ code: "crm", label: "고객", generation: "manual" }, {
        code: "app",
        label: "앱",
        generation: "short",
      }],
    },
  }).entity_identity!;
  assertEquals(settings.default_source, "crm");
  assertEquals(settings.sources.map((source) => source.generation), ["manual", "short"]);
});
Deno.test("기존 기본 발급처와 공통 발급 방식을 읽을 때 선택을 보존한다", () => {
  const settings = resolvedBusinessSettings({
    entity_identity: {
      generation: "manual",
      default_source: "crm",
      sources: [{ code: "app", label: "앱" }, { code: "crm", label: "고객" }],
    },
  }).entity_identity!;
  assertEquals(settings.sources[0].code, "crm");
  assertEquals(settings.generation, "manual");
});
