import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ConfirmOpts = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};
type NotifyKind = "info" | "error" | "success";
type NotifyOpts = {
  title?: string;
  message: string;
  kind?: NotifyKind;
};

type UIApi = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  notify: (opts: NotifyOpts) => Promise<void>;
};

const UIContext = createContext<UIApi>({
  confirm: async () => false,
  notify: async () => {},
});

type ConfirmState = ConfirmOpts & { resolve: (v: boolean) => void };
type NotifyState = NotifyOpts & { resolve: () => void };

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [notifyState, setNotifyState] = useState<NotifyState | null>(null);

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const notify = useCallback((opts: NotifyOpts) => {
    return new Promise<void>((resolve) => {
      setNotifyState({ ...opts, resolve });
    });
  }, []);

  function closeConfirm(value: boolean) {
    confirmState?.resolve(value);
    setConfirmState(null);
  }
  function closeNotify() {
    notifyState?.resolve();
    setNotifyState(null);
  }

  // Esc закрывает диалог как «отмена» / «ок» соответственно
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmState) closeConfirm(false);
        else if (notifyState) closeNotify();
      } else if (e.key === "Enter") {
        if (confirmState) closeConfirm(true);
        else if (notifyState) closeNotify();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmState, notifyState]); // eslint-disable-line

  return (
    <UIContext.Provider value={{ confirm, notify }}>
      {children}
      {confirmState && (
        <Backdrop onClick={() => closeConfirm(false)}>
          <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
            {confirmState.title && <h3 className="ui-dialog-title">{confirmState.title}</h3>}
            <div className="ui-dialog-body" style={{ whiteSpace: "pre-line" }}>{confirmState.message}</div>
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => closeConfirm(false)} autoFocus>
                {confirmState.cancelText ?? "Отмена"}
              </button>
              <button
                type="button"
                className={confirmState.danger ? "primary danger" : "primary"}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmText ?? "Подтвердить"}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
      {notifyState && (
        <Backdrop onClick={() => closeNotify()}>
          <div className={"ui-dialog ui-dialog-" + (notifyState.kind ?? "info")} onClick={(e) => e.stopPropagation()}>
            {notifyState.title && <h3 className="ui-dialog-title">{notifyState.title}</h3>}
            <div className="ui-dialog-body" style={{ whiteSpace: "pre-line" }}>{notifyState.message}</div>
            <div className="ui-dialog-actions">
              <button type="button" className="primary" onClick={() => closeNotify()} autoFocus>
                Ок
              </button>
            </div>
          </div>
        </Backdrop>
      )}
    </UIContext.Provider>
  );
}

function Backdrop({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div className="ui-backdrop" onClick={onClick} role="dialog" aria-modal="true">
      {children}
    </div>
  );
}

export const useUI = () => useContext(UIContext);
