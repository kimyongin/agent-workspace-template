import { useNavigate } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardDescription } from "@/components/ui/card";
import { PageHeading } from "../../components/PageHeading.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";

const sections = [
  {
    key: "types",
    to: "/settings/materials",
    label: "자료 종류",
    description: "상품·주문·재료·레시피처럼 관리할 자료를 구분합니다.",
  },
  {
    key: "relations",
    to: "/settings/relations",
    label: "연결 설정",
    description: "어떤 자료끼리 연결할 수 있는지와 연결할 개수를 정합니다.",
  },
  {
    key: "numbers",
    to: "/settings/issuers",
    label: "번호 설정",
    description: "번호 출처는 쿠팡·옥션처럼 구분하고, 번호 종류는 상품 번호·주문 번호처럼 용도를 나눕니다.",
  },
  {
    key: "exchange",
    to: "/settings/data-model",
    label: "일괄 설정",
    description: "자료 종류·연결·번호 설정을 한 번에 가져오거나 내보냅니다. 등록한 자료 내용은 포함하지 않습니다.",
  },
] as const;

export function MaterialSettingsHeading({ section, id }: {
  section: typeof sections[number]["key"];
  id?: string;
}) {
  const navigate = useNavigate();
  return (
    <>
      <PageHeading title="자료 설정" description="자료 종류·연결 방법·번호 설정을 함께 관리합니다." id={id}>
        <SettingsMenu />
      </PageHeading>
      <Tabs value={section} activationMode="manual" onValueChange={key => { const target = sections.find(item => item.key === key); if(target) void navigate(target.to); }}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4" aria-label="자료 설정 항목">
          {sections.map(({ key, label }) => <TabsTrigger key={key} value={key} aria-current={section === key ? "page" : undefined} className="min-h-[max(2.75rem,44px)] whitespace-normal">{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <CardDescription>{sections.find(({ key }) => key === section)?.description}</CardDescription>
    </>
  );
}
