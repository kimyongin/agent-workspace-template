import { cn } from "../lib/utils.ts";
// 긴 본문의 안전한 표시: raw HTML을 실행하지 않고(react-markdown 기본), 스크립트 URL을 막고,
// 외부 이미지는 자동으로 불러오지 않고 링크로 보여 준다(docs/design/ui-patterns.md "타임라인과 긴 본문").
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE = /^(https?:|mailto:|#|\/)/i;

export function MarkdownContent({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) return <p className="text-sm text-muted-foreground">본문 없음</p>;
  return (
    <div className={cn("markdown min-w-0 whitespace-pre-wrap wrap-anywhere", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (SAFE.test(url) ? defaultUrlTransform(url) : "")}
        components={{
          a: ({ href, children }) =>
            href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>,
          img: ({ src, alt }) =>
            src ? <a href={String(src)} target="_blank" rel="noopener noreferrer nofollow">이미지: {alt || src}</a> : null,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
