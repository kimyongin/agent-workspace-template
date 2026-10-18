import { Link } from "../lib/workspace-router.tsx";
import { Button } from "./ui/button.tsx";
export function GuideLink() {
  return <Button asChild variant="ghost"><Link to="/guide">사용 가이드</Link></Button>;
}
