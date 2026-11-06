"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X, RotateCcw } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastContextValue {
  showToast: (message: string, type?: "success" | "error" | "info", action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const removeToast = useCallback((id: string) => {
    setRemovingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 180);
  }, []);

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "success", action?: ToastAction) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev.slice(-2), { id, message, type, action }]);

      // Toasts with an action (e.g. Undo) stay long enough to react to
      setTimeout(() => {
        removeToast(id);
      }, action ? 6000 : 2800);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const isRemoving = removingIds.has(toast.id);
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-[#18181b] border border-[#2d2d34] text-[#efeff1] text-xs font-medium shadow-xl hover:border-[#9146ff]/40 transition-all ${
                isRemoving ? "animate-slide-out-left" : "animate-slide-in-right"
              }`}
            >
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  removeToast(toast.id);
                }}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-[#bf94ff] hover:text-white bg-[#9146ff]/15 hover:bg-[#9146ff]/30 rounded transition-colors flex-shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                {toast.action.label}
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {toast.type === "error" ? (
                <AlertCircle className="w-4 h-4 text-[#eb0400] flex-shrink-0" />
              ) : toast.type === "info" ? (
                <Info className="w-4 h-4 text-[#9146ff] flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#00f59b] flex-shrink-0" />
              )}
              <span className="line-clamp-3 break-words">{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-0.5 text-[#767682] hover:text-[#efeff1] rounded transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
