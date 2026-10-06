import type { SearchItem } from "@contracts/search.ts";

const matchNames = {both:"키워드·의미",keyword:"키워드",semantic:"의미"};
const indexNames = {pending:"색인 대기",excluded:"색인 제외",indexed:"색인 완료"};

export function SearchMatch({item}: {item:Pick<SearchItem,"match"|"index_state">}) {
  return <span className="meta">{matchNames[item.match]} · {indexNames[item.index_state]}</span>;
}
