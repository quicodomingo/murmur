import { Component, type ReactNode } from "react";

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
    return (
      <div className="grid h-screen place-items-center bg-background p-8 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-[17px] font-semibold">Murmur ha trobat un error</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">Les reunions estan desades. Torna-ho a provar; si es repeteix, envia'ns aquest missatge:</p>
          <pre className="selectable mt-3 max-h-40 overflow-auto rounded-md bg-mm-fill-subtle p-3 text-left text-[11px] whitespace-pre-wrap">{String(this.state.error.stack ?? this.state.error)}</pre>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-4 h-7 rounded-[7px] bg-mm-accent px-3 text-[13px] font-semibold text-mm-on-accent hover:opacity-90"
          >
            Torna-ho a provar
          </button>
        </div>
      </div>
    );
  }
}
