import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Spinner } from "./ui/spinner.tsx";

class ViewLoadBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? (
        <Alert variant="destructive">
          <AlertTitle>{this.props.label} 화면을 불러오지 못했습니다</AlertTitle>
          <AlertDescription>
            연결을 확인한 뒤 새로고침해 주세요. 작성 중인 내용은 먼저 보관해 주세요.
          </AlertDescription>
        </Alert>
      )
      : this.props.children;
  }
}

/** Declare once at module scope so navigation and parent renders retain the loaded view. */
export function deferView<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
) {
  const View = lazy(load);
  return function DeferredView(props: Props) {
    return (
      <ViewLoadBoundary label={label}>
        <Suspense fallback={
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" />{label} 화면을 불러오는 중…
          </div>
        }>
          <View {...props} />
        </Suspense>
      </ViewLoadBoundary>
    );
  };
}
