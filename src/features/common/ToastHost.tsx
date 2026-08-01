import { X } from "lucide-react";

// Transient, self-dismissing status messages (e.g. a failed follow/unfollow
// write). Consumed via useToast() from any surface; the host renders as a
// fixed overlay owned by App. There is deliberately no toast primitive anywhere
// else in the app, so this is the single place to add new ones.
export type ToastKind = "error" | "info" | "success";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

// Fixed overlay listing active toasts. Errors use role="alert" so assistive
// tech announces them immediately; informational toasts use role="status".
export function ToastHost({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="toast-host" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.message}</span>
          <button type="button" className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
