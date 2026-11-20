// Bottom-of-screen message with Undo, in its own window (so it shows while the notch is closed).
import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { native } from "../lib/native";
import { loadPrefs, TEXT_SCALE } from "../lib/prefs";
import type { ToastMessage } from "../lib/store";
import { Close } from "../icons";

const SHOW_MS = 4000;

export function ToastApp() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const hideTimer = useRef<number>();

  const hide = () => {
    window.clearTimeout(hideTimer.current);
    setToast(null);
    void native.hideToast();
  };

  const armHide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(hide, SHOW_MS);
  };

  useEffect(() => {
    const off = listen<ToastMessage>("toast", (e) => {
      setToast(e.payload);
      // Width follows the message; the window is resized to fit and centred above the taskbar.
      const width = Math.min(560, Math.max(280, e.payload.message.length * 7.4 + (e.payload.undo ? 170 : 90)));
      const zoom = TEXT_SCALE[loadPrefs().textSize] ?? 1;
      void native.showToast(Math.round(width * zoom), Math.round(64 * zoom));
      armHide();
    });
    return () => void off.then((f) => f());
  }, []);

  if (!toast) return null;
  return (
    <div className="toast-wrap" onMouseEnter={() => window.clearTimeout(hideTimer.current)} onMouseLeave={armHide}>
      <div className="toast" role="status" aria-live="polite">
        <span className="ellipsis" style={{ fontWeight: 500 }}>{toast.message}</span>
        {toast.undo && (
          <button
            className="pill primary small"
            onClick={() => {
              void emitTo("notch", "toast-undo", toast.id);
              hide();
            }}
          >
            {toast.actionLabel ?? "Undo"}
          </button>
        )}
        <button className="icon-btn" aria-label="Dismiss" onClick={hide}><Close size={11} /></button>
      </div>
    </div>
  );
}
