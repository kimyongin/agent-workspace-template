import { Link } from "../../lib/workspace-router.tsx";
import { useWorkspaceId } from "../../lib/workspace-route.tsx";
import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";
import { workspaceSettingsDestinations } from "./SettingsNavigation.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function WorkspaceSettingsSection() {
  const workspaceId = useWorkspaceId(), capability = useWorkspaceCapabilities();
  return <Card role="region" aria-labelledby="settings-workspaces">
    <CardHeader>
      <CardTitle><h2 id="settings-workspaces">워크스페이스</h2></CardTitle>
      {capability && <CardDescription>현재 공간 · {capability.workspace.name}</CardDescription>}
    </CardHeader>
    <CardContent className="flex flex-wrap gap-2">
      {workspaceSettingsDestinations(workspaceId, capability?.can_manage ?? false).map(({ to, label }) =>
        <Button key={to} asChild variant="outline"><Link to={to}>{label}</Link></Button>)}
    </CardContent>
  </Card>;
}
