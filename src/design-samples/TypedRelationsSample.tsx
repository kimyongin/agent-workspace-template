import { useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { CollectionList } from "../components/Collection.tsx";
import { Field } from "../components/Field.tsx";
import { RelatedItem } from "../components/RelatedItems.tsx";
/** Presentation-only example: the app's real permission, version and atomic writes are integration-tested. */
export function TypedRelationsSample() {
  const [selected, setSelected] = useState(true),
    [more, setMore] = useState(false),
    [writing, setWriting] = useState(false),
    [title, setTitle] = useState("");
  return (
    <section aria-label="자료 상세 관계 샘플">
      <h3 className="section-title">자료 상세 예시</h3>
      <p className="secondary">
        하나만은 값 한 줄, 여러 개는 기존 연속 목록으로 표시합니다. 아래 조작은
        이 샘플에만 반영됩니다.
      </p>
      <section className="detail-section">
        <div className="detail-section-head">
          <h4 className="section-title">소속 주문</h4>
          <div className="actions">
            <BodyAction icon="create" onClick={() => setWriting(true)}>
              작성
            </BodyAction>
            <BodyAction icon="link" onClick={() => setSelected(true)}>
              {selected ? "변경" : "연결"}
            </BodyAction>
            {selected && (
              <BodyAction
                icon="unlink"
                onClick={() => setSelected(false)}
              >
                해제
              </BodyAction>
            )}
          </div>
        </div>
        <p>{selected ? "주문 2026-001" : "연결된 자료가 없습니다."}</p>
      </section>
      {writing && (
        <section
          className="detail-section form"
          aria-label="작성해서 연결 샘플"
        >
          <h4 className="section-title">작성 후 연결</h4>
          <p>주문품목 → 소속 주문</p>
          <p className="secondary">
            기존 연결: 주문 2026-001. 저장하면 새로 작성한 자료로 교체합니다.
          </p>
          <Field label="번호">{() => <p>등록 시 자동 발급</p>}</Field>
          <Field label="주문명" required>
            {(p) => (
              <input
                {...p}
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="actions">
            <button className="btn" onClick={() => setWriting(false)}>
              취소
            </button>
            <button
              className="btn btn-primary"
              disabled={!title.trim()}
              onClick={() => {
                setWriting(false);
                setSelected(true);
              }}
            >
              작성하고 연결
            </button>
          </div>
        </section>
      )}
      <section className="detail-section">
        <div className="detail-section-head">
          <h4 className="section-title">
            구성재료 ({more ? 4 : 2}개{more ? "" : "+"})
          </h4>
          <BodyAction icon="link">연결</BodyAction>
        </div>
        <CollectionList>
          {["밀가루", "달걀", ...(more ? ["우유", "소금"] : [])].map((
            title,
          ) => (
            <li key={title}>
              <RelatedItem
                title={title}
                metadata="재료"
                action={<BodyAction icon="unlink">해제</BodyAction>}
              />
            </li>
          ))}
        </CollectionList>
        {!more && (
          <BodyAction onClick={() => setMore(true)}>
            더 보기
          </BodyAction>
        )}
      </section>
    </section>
  );
}
