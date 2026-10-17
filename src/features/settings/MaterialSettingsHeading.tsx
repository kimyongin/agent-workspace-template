import { Link } from "react-router";
import { PageHeading } from "../../components/PageHeading.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import "./settings.css";

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
    description: "어느 곳의 어떤 번호를 사용할지 정합니다.",
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
  return (
    <>
      <PageHeading title="자료 설정" description="자료 종류·연결 방법·번호 설정을 함께 관리합니다." id={id}>
        <SettingsMenu />
      </PageHeading>
      <nav className="material-settings-tabs" aria-label="자료 설정 항목">
        {sections.map(({ key, to, label }) => (
          <Link key={key} to={to} aria-current={section === key ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      <p className="material-settings-description secondary">
        {sections.find(({ key }) => key === section)?.description}
      </p>
    </>
  );
}
