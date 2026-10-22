import { PageHeading } from "../../components/PageHeading.tsx";

export function SettingsHeading(
  { title, description, id, tabIndex }: { title: string; description: string; id?: string; tabIndex?: number },
) {
  return (
    <PageHeading title={title} description={description} id={id} tabIndex={tabIndex}>
    </PageHeading>
  );
}
