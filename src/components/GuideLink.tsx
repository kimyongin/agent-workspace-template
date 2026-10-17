import { Link } from "react-router";
import { Button } from "./ui/button.tsx";
export function GuideLink() {
  return <Button asChild variant="ghost"><Link to="/guide">사용 가이드</Link></Button>;
}
