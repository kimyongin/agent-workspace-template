// A mounted protected read belongs to one captured API adapter (account + workspace).
// Keys never encode identity or protected values and do not escape the React tree.
const keys = new WeakMap<object, number>();
let nextKey = 0;
export function readApiKey(api: object): number {
  let key = keys.get(api);
  if (key === undefined) {
    key = ++nextKey;
    keys.set(api, key);
  }
  return key;
}
