import { DataFields } from "@/components/DataFields";
import { PlusIcon, LinkIcon, UnlinkIcon } from "lucide-react";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { useState } from "react";

import { CollectionItem, CollectionList  } from "../components/Collection.tsx";
import { Field } from "../components/Field.tsx";
import { RelatedEmpty, RelatedItem } from "../components/RelatedItems.tsx";
/** Presentation-only example: the app's real permission, version and atomic writes are integration-tested. */
export function TypedRelationsSample() {
  const [selected, setSelected] = useState(true),
    [more, setMore] = useState(false),
    [writing, setWriting] = useState(false),
    [title, setTitle] = useState("");
  return (
    <section aria-label="자료 상세 관계 샘플">
      <h3 className="text-base font-semibold">자료 상세 예시</h3>
      <p className="text-sm text-muted-foreground">
        하나만은 값 한 줄, 여러 개는 기존 연속 목록으로 표시합니다. 아래 조작은
        이 샘플에만 반영됩니다.
      </p>
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-base font-semibold">소속 주문 ({selected ? 1 : 0}개)</h4>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" type="button"  onClick={() => setWriting(true)}><PlusIcon data-icon="inline-start" />
              작성
            </Button>
            <Button variant="ghost" type="button"  onClick={() => setSelected(true)}><LinkIcon data-icon="inline-start" />
              {selected ? "변경" : "연결"}
            </Button>
            {selected && (
              <Button variant="ghost" type="button"
                onClick={() => setSelected(false)}
              ><UnlinkIcon data-icon="inline-start" />
                해제
              </Button>
            )}
          </div>
        </div>
        {selected ? <DataFields><div><dt>주문명</dt><dd>주문 2026-001</dd></div></DataFields> : <RelatedEmpty description="작성하거나 연결해 자료를 추가하세요." />}
      </section>
      {writing && (
        <section
          className="flex min-w-0 flex-col gap-5"
          aria-label="작성해서 연결 샘플"
        >
          <h4 className="text-base font-semibold">작성 후 연결</h4>
          <DataFields>
            <div><dt>연결 설정</dt><dd>주문품목 → 소속 주문</dd></div>
            <div><dt>기존 연결</dt><dd>주문 2026-001</dd></div>
            <div><dt>번호</dt><dd>등록 시 자동 발급</dd></div>
          </DataFields>
          <p className="text-sm text-muted-foreground">저장하면 새로 작성한 자료로 교체합니다.</p>
          <Field label="주문명" required>
            {(p) => (
              <Input
                {...p}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline"  onClick={() => setWriting(false)}>
              취소
            </Button>
            <Button variant="default"
              disabled={!title.trim()}
              onClick={() => {
                setWriting(false);
                setSelected(true);
              }}
            >
              작성하고 연결
            </Button>
          </div>
        </section>
      )}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-base font-semibold">
            구성재료 ({more ? 4 : 2}개{more ? "" : "+"})
          </h4>
          <Button variant="ghost" type="button" ><LinkIcon data-icon="inline-start" />연결</Button>
        </div>
        <CollectionList>
          {["밀가루", "달걀", ...(more ? ["우유", "소금"] : [])].map((
            title,
          ) => (
            <CollectionItem key={title}>
              <RelatedItem
                title={title}
                titleLabel="자료 이름"
                metadata={<DataFields><div><dt>종류</dt><dd>재료</dd></div></DataFields>}
                action={<Button variant="ghost" type="button" ><UnlinkIcon data-icon="inline-start" />해제</Button>}
              />
            </CollectionItem>
          ))}
        </CollectionList>
        {!more && (
          <Button variant="ghost" type="button" onClick={() => setMore(true)}>
            더 보기
          </Button>
        )}
      </section>
    </section>
  );
}
