import { Link } from "react-router";
import { BodyActionFace } from "./BodyAction.tsx";

export function GuideLink() {
  return <Link className="body-action" to="/guide"><BodyActionFace>사용 가이드</BodyActionFace></Link>;
}
