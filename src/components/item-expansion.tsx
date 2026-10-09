import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const ItemExpansion = createContext<{value:readonly string[];toggle:(key:string)=>void;setMany:(keys:readonly string[],open:boolean)=>void}|null>(null);
const ExpansionGroup = createContext<{paths:readonly string[];register:(path:string)=>()=>void}|null>(null);

/** A collection only controls the disclosures currently rendered inside its own group. */
export function ExpansionGroupProvider({children}:{children:ReactNode}) {
  const [paths,setPaths]=useState<string[]>([]);
  const register=useCallback((path:string)=>{
    setPaths(prior=>prior.includes(path)?prior:[...prior,path]);
    return ()=>setPaths(prior=>prior.filter(value=>value!==path));
  },[]);
  return <ExpansionGroup.Provider value={{paths,register}}>{children}</ExpansionGroup.Provider>;
}
export function useExpansionRegistration(path:string|undefined,enabled:boolean) {
  const register=useContext(ExpansionGroup)?.register;
  useEffect(()=>path&&enabled&&register?register(path):undefined,[path,enabled,register]);
}
export function useCollectionExpansion() {
  const group=useContext(ExpansionGroup),selection=useContext(ItemExpansion);
  if(!group?.paths.length||!selection)return null;
  const allOpen=group.paths.every(path=>selection.value.includes(path));
  return {allOpen,toggle:()=>selection.setMany(group.paths,!allOpen)};
}
