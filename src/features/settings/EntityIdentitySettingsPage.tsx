import { useEffect, useState } from "react";
import { Link, useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { EntityIdentitySettings } from "./EntityIdentitySettings.tsx";
import "./settings.css";
export function EntityIdentitySettingsPage() {
  const [state, setState] = useState({ dirty: false, busy: false });
  const blocker = useBlocker(state.dirty || state.busy);
  useEffect(() => {
    if (state.busy && blocker.state === "blocked") blocker.reset();
  }, [state.busy, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (state.dirty || state.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [state]);
  return (
    <section className="panel settings" aria-labelledby="identity-page-title">
      <nav aria-label="설정 경로">
        <Link to="/settings">설정</Link>
        <span aria-hidden="true">/</span>
        <span>자료 식별자·발급처</span>
      </nav>
      <h1 className="page-title" id="identity-page-title">자료 식별자·발급처</h1>
      <EntityIdentitySettings onStateChange={setState} />
      <ConfirmDialog
        open={!state.busy && blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message="저장하지 않은 식별자 설정이 사라집니다."
        confirmLabel="변경 버리기"
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </section>
  );
}
