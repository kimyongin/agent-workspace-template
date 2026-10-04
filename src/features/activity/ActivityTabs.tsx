import { NavLink } from "react-router";

export function ActivityTabs() {
  return <nav className="activity-tabs" aria-label="활동 종류">
    <NavLink to="/tasks" end>할 일</NavLink>
    <NavLink to="/records" end>기록</NavLink>
  </nav>;
}
