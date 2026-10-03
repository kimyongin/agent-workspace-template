import {useSearchParams} from "react-router";
/** 검색 상세의 세 원문 종류가 같은 복귀 계약을 사용한다. 경로는 항상 앱 내부 검색이다. */
export function useSearchReturn(fallback:string,label:string){
  const [params]=useSearchParams(),search=params.get("search");
  return search?{path:`/search?${search}`,label:"← 검색 결과"}:{path:fallback,label};
}
