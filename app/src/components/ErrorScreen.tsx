import { Component, type ReactNode } from "react";
import { Translation } from "react-i18next";

/** A crash shows what went wrong and a way out, instead of a blank window. */
export class ErrorScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return (
      <Translation ns="errorScreen">
        {(t) => (
          <div className="grid h-screen place-items-center bg-background p-8 text-foreground">
            <div className="max-w-md text-center">
              <h1 className="text-[17px] font-semibold">{t("title")}</h1>
              <p className="mt-2 text-[13px] text-muted-foreground">{t("body")}</p>
              <pre className="selectable mt-3 max-h-40 overflow-auto rounded-md bg-mm-fill-subtle p-3 text-left text-[11px] whitespace-pre-wrap">{String(error.stack ?? error)}</pre>
              <button
                type="button"
                onClick={() => location.reload()}
                className="mt-4 h-7 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent hover:opacity-90"
              >
                {t("common:retry")}
              </button>
            </div>
          </div>
        )}
      </Translation>
    );
  }
}
