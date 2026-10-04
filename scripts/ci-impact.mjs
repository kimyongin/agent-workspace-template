// Fail closed: only proved documentation/static presentation edits avoid integration.
import { parse } from "@babel/parser";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const displayAttributes = new Set(["title", "placeholder", "aria-label"]);
const displayTags = new Set("a article aside b blockquote button caption code dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header i label legend li main nav ol p pre section small span strong summary table tbody td th thead time tr ul".split(" "));
const attributeTags = new Set([...displayTags, "br", "fieldset", "form", "hr", "img", "input", "option", "select", "textarea"]);
const ignoredAstKeys = new Set(["start", "end", "loc", "extra"]);

export function presentationTsx(before, after) {
  try {
    function normalized(source) {
      const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
      // Comments may carry JSX pragmas/build directives; compare them verbatim.
      const comments = ast.comments.map(({ type, value }) => ({ type, value }));
      let unsafe = false;
      function visit(node, intrinsic = false, textAllowed = false) {
        if (!node || typeof node !== "object") return node;
        if (Array.isArray(node)) return node.map((item) => visit(item, intrinsic, textAllowed));
        if (node.type === "JSXOpeningElement") {
          intrinsic = node.name.type === "JSXIdentifier" && attributeTags.has(node.name.name);
        }
        if (node.type === "JSXElement") {
          const tag = node.openingElement.name;
          if (tag.type === "JSXIdentifier" && ["script", "style"].includes(tag.name)) unsafe = true;
        }
        if (node.type === "JSXText") return { type: node.type, value: textAllowed ? "<display>" : node.value };
        if (node.type === "JSXAttribute" && node.name.name === "dangerouslySetInnerHTML") unsafe = true;
        if (intrinsic && node.type === "JSXAttribute" && displayAttributes.has(node.name.name) && node.value?.type === "StringLiteral") {
          return { type: node.type, name: visit(node.name), value: { type: "StringLiteral", value: "<display>" } };
        }
        return Object.fromEntries(Object.entries(node).filter(([key]) => !ignoredAstKeys.has(key) && key !== "comments").map(([key, value]) => {
          const tag = node.type === "JSXElement" ? node.openingElement.name : null;
          const childText = key === "children" && tag?.type === "JSXIdentifier" && displayTags.has(tag.name);
          return [key, visit(value, intrinsic, childText)];
        }));
      }
      const tree = visit(ast);
      if (unsafe) throw new Error("executable JSX");
      return JSON.stringify({ tree, comments });
    }
    return normalized(before) === normalized(after);
  } catch {
    return false;
  }
}

const styleProperties = /^(?:color|background-color|border(?:-(?:top|right|bottom|left))?(?:-(?:color|width|style|radius))?|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap|font-(?:size|weight|family)|line-height|letter-spacing|text-align|width|max-width|min-width|height|min-height|max-height|flex-direction|flex-wrap|align-items|justify-content)$/;

export function presentationCss(before, after) {
  // Mask only limited values inside plain flat selectors. Everything else,
  // including surrounding at-rules/comments and interactive selectors, stays exact.
  function normalize(source) {
    // No lexical escapes/comments in declarations: avoid treating comment strings
    // or escaped CSS as ordinary property/value syntax.
    if (/\\|url\s*\(/i.test(source)) return null;
    return source.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector, body) => {
      if (!/^[\w\s.#,>+*-]+$/.test(selector) || /auth|login|consent|hidden|sr-only/i.test(selector) || /\/\*/.test(body)) return rule;
      const masked = body.replace(/(^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/g, (declaration, separator, property, value) => {
        if (!styleProperties.test(property) || !/^[\w\s#.,()%+*/-]+$/.test(value)) return declaration;
        let depth = 0;
        for (const character of value) {
          if (character === "(") depth++;
          if (character === ")" && --depth < 0) return declaration;
        }
        if (depth !== 0) return declaration;
        return `${separator}${property}:<display>`;
      });
      return `${selector}{${masked}}`;
    });
  }
  const a = normalize(before), b = normalize(after);
  return a !== null && a === b;
}

export function documentationHtml(before, after) {
  // Only prose between identical tags. Scripts/styles and comments stay exact.
  for (const source of [before, after]) {
    if ((source.match(/<!--/g) ?? []).length !== (source.match(/<!--[\s\S]*?-->/g) ?? []).length) return false;
    for (const tag of ["script", "style"]) {
      if ((source.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length !== (source.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi")) ?? []).length) return false;
    }
    if (source.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]*>/gi, "").includes("<")) return false;
  }
  const normalize = (source) => source.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]*>|[^<]+/gi, (part) => part.startsWith("<") ? part : "<prose>");
  return normalize(before) === normalize(after);
}

export function classifyChanges(changes, { forceFull = false } = {}) {
  if (forceFull) return { mode: "full", reasons: ["forced full verification"] };
  if (!changes.length) return { mode: "full", reasons: ["empty or unavailable diff"] };
  const kinds = new Set(), reasons = [];
  for (const { status, path, before, after } of changes) {
    let kind = "full";
    if (["M", "A"].includes(status) && typeof after === "string") {
      if (/^(?:docs\/|\.agents\/skills\/).*\.md$/.test(path) || /^(?:README|AGENTS|CLAUDE)\.md$/.test(path)) kind = "docs";
      else if (status === "M" && typeof before === "string") {
        if (/^docs\/.*\.html$/.test(path) && documentationHtml(before, after)) kind = "docs";
        else if (/^src\/(?:features\/(?!auth\/)|components\/).*\.tsx$/.test(path) && !/auth|oauth|token/i.test(path) && presentationTsx(before, after)) kind = "presentation";
        else if (/^src\/styles\/.*\.css$/.test(path) && presentationCss(before, after)) kind = "presentation";
      }
    }
    kinds.add(kind);
    reasons.push(`${status} ${path}: ${kind}`);
  }
  // Documentation accompanying presentation evidence does not increase runtime risk.
  const mode = kinds.has("full") ? "full" : kinds.has("presentation") ? "presentation" : "docs";
  return { mode, reasons };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

export function comparisonRange(eventName, event, resolveMergeBase) {
  if (eventName === "pull_request") {
    const base = event.pull_request?.base?.sha, head = event.pull_request?.head?.sha;
    if (!base || !head) throw new Error("missing PR base/head");
    return { base: resolveMergeBase(base, head), head };
  }
  if (eventName === "push" && /^[0-9a-f]{40}$/.test(event.before ?? "") && !/^0+$/.test(event.before)) {
    return { base: event.before, head: event.after };
  }
  throw new Error("unsupported event or unavailable base");
}

export function gitChanges(base, head) {
  const fields = git("diff", "--name-status", "-z", "--find-renames", base, head).split("\0");
  const changes = [];
  for (let i = 0; fields[i];) {
    const status = fields[i++], path = fields[i++];
    if (/^[RC]/.test(status)) {
      changes.push({ status, path: `${path} -> ${fields[i++]}` });
      continue;
    }
    const read = (ref) => git("show", `${ref}:${path}`);
    changes.push({ status, path, before: status === "M" ? read(base) : null, after: ["M", "A"].includes(status) ? read(head) : null });
  }
  return changes;
}

export function main(env = process.env) {
  let result, range;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    if (env.GITHUB_EVENT_NAME === "workflow_dispatch") result = classifyChanges([], { forceFull: true });
    else {
      range = comparisonRange(env.GITHUB_EVENT_NAME, event, (a, b) => git("merge-base", a, b).trim());
      result = classifyChanges(gitChanges(range.base, range.head));
    }
  } catch (error) {
    result = { mode: "full", reasons: [`classification unavailable: ${error.message.split("\n")[0]}`] };
  }
  console.log(JSON.stringify({ ...result, range }, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Change impact: ${result.mode}\n\n${range ? `Comparison: ${range.base} → ${range.head}\n\n` : ""}${result.reasons.map((reason) => `- ${reason.replace(/[\r\n]/g, " ")}`).join("\n")}\n\n${result.mode === "full" ? "Full check and isolated integration required." : "Heavy server/DB/HTTP/MCP/E2E steps omitted; presentation still requires ticketed viewport/keyboard/focus checks."}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
