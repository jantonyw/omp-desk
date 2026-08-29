import React, { useState, useEffect, useRef } from "react";
import type { ExtensionUiRequest } from "../protocol";

interface PermissionDialogProps {
  request: ExtensionUiRequest | null;
  onRespond: (requestId: string, response: Record<string, unknown>) => void;
}

/** omp select() returns the option *label*; index-only payloads are treated as cancel. */
export function buildExtensionUiResponse(
  request: ExtensionUiRequest,
  action: "allow" | "deny",
  opts?: { selectedIndex?: number; inputText?: string },
): Record<string, unknown> {
  if (action === "deny") {
    if (request.method === "confirm") return { confirmed: false };
    return { cancelled: true, timedOut: false };
  }
  if (request.method === "confirm") return { confirmed: true };
  if (request.method === "select") {
    const idx = opts?.selectedIndex ?? 0;
    const value = request.options?.[idx];
    return typeof value === "string" ? { value } : { cancelled: true, timedOut: false };
  }
  if (request.method === "input" || request.method === "editor") {
    return { value: opts?.inputText ?? "" };
  }
  return { confirmed: true };
}

export function PermissionDialog({
  request,
  onRespond,
}: PermissionDialogProps): React.ReactElement | null {
  const [inputText, setInputText] = useState("");
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const enterArmedRef = useRef(false);

  useEffect(() => {
    if (!request || request.method === "cancel") return;
    setInputText(request.prefill || "");

    // Default to 'Approve' / 'Allow' option if available in select list
    if (request.method === "select" && Array.isArray(request.options)) {
      const approveIdx = request.options.findIndex((opt) =>
        /allow|approve|yes|同意|允许|确定/i.test(opt),
      );
      setSelectedOptionIndex(approveIdx >= 0 ? approveIdx : 0);
    } else {
      setSelectedOptionIndex(0);
    }

    enterArmedRef.current = false;
    // 600ms debounce to prevent accidental double-Enter submission
    const arm = window.setTimeout(() => {
      enterArmedRef.current = true;
    }, 600);
    const focus = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 50);
    return () => {
      window.clearTimeout(arm);
      window.clearTimeout(focus);
    };
  }, [request]);

  if (!request || request.method === "cancel") return null;

  const handleAllow = () => {
    onRespond(
      request.id,
      buildExtensionUiResponse(request, "allow", {
        selectedIndex: selectedOptionIndex,
        inputText,
      }),
    );
  };

  const handleDeny = () => {
    onRespond(request.id, buildExtensionUiResponse(request, "deny"));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      handleDeny();
      return;
    }
    if (e.key === "ArrowDown" && request.method === "select" && request.options) {
      e.preventDefault();
      setSelectedOptionIndex((prev) => (prev + 1) % request.options!.length);
      return;
    }
    if (e.key === "ArrowUp" && request.method === "select" && request.options) {
      e.preventDefault();
      setSelectedOptionIndex((prev) => (prev - 1 + request.options!.length) % request.options!.length);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && request.method !== "editor") {
      e.preventDefault();
      if (enterArmedRef.current) handleAllow();
    }
  };

  const promptText = request.message || (request.method === "select" ? request.title : "");
  const heading =
    request.method === "select"
      ? "权限确认 · Permission Request"
      : request.title ||
        (request.method === "confirm" ? "权限确认 · Permission Request" : "交互输入 · Input Required");

  return (
    <div className="permission-backdrop" onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        tabIndex={-1}
      >
        <div className="permission-head">
          <div className="permission-head-title">
            <span className="permission-icon" aria-hidden="true">
              🛡️
            </span>
            <span id="perm-title">{heading}</span>
          </div>
          <button
            type="button"
            className="permission-close-btn"
            title="Deny / Close"
            onClick={handleDeny}
          >
            ✕
          </button>
        </div>

        <div className="permission-body">
          {promptText && (
            <div className="permission-message-box">
              <pre className="permission-code-preview">
                <code>{promptText}</code>
              </pre>
            </div>
          )}

          {request.method === "select" && request.options && (
            <div className="permission-options-list">
              {request.options.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`permission-option-item ${idx === selectedOptionIndex ? "active" : ""}`}
                  onClick={() => setSelectedOptionIndex(idx)}
                >
                  <span className="permission-radio">{idx === selectedOptionIndex ? "●" : "○"}</span>
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          )}

          {(request.method === "input" || request.method === "editor") && (
            <div className="permission-input-wrap">
              {request.method === "editor" ? (
                <textarea
                  className="permission-textarea"
                  rows={6}
                  placeholder={request.placeholder || "Enter text..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="permission-input"
                  placeholder={request.placeholder || "Enter value..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
              )}
            </div>
          )}
        </div>

        <div className="permission-actions">
          <button type="button" className="permission-btn-deny" onClick={handleDeny}>
            拒绝 (Deny)
          </button>
          <button type="button" className="permission-btn-allow" onClick={handleAllow}>
            允许执行 (Allow)
          </button>
        </div>
      </div>
    </div>
  );
}
