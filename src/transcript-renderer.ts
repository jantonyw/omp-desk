import { marked } from "marked";
import DOMPurify from "dompurify";
import type { TranscriptHint } from "./client";
import { getEntries } from "./client";

marked.setOptions({ gfm: true, breaks: true });

const MD_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
  "strong",
  "em",
  "blockquote",
  "br",
  "hr",
];

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_TAGS,
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TranscriptRendererElements {
  transcriptEl: HTMLElement;
  paneChatEl: HTMLElement;
  welcomeEl: HTMLElement;
}

export interface TranscriptRenderer {
  schedulePaint: (hint: TranscriptHint) => void;
  paintFull: () => void;
  paintLiveStream: () => void;
  updateEmptyChat: () => void;
}

export function initTranscriptRenderer(
  elements: TranscriptRendererElements,
): TranscriptRenderer {
  const { transcriptEl, paneChatEl, welcomeEl } = elements;

  let paintScheduled = false;
  let paintMode: "stream" | "full" = "full";

  function hasChatMessages(): boolean {
    return getEntries().some((e) => e.role === "user" || e.role === "assistant");
  }

  function updateEmptyChat(): void {
    const empty = !hasChatMessages();
    paneChatEl.classList.toggle("empty-chat", empty);
    welcomeEl.setAttribute("aria-hidden", empty ? "false" : "true");
  }

  function paintLiveStream(): void {
    const entries = getEntries();
    const live = [...entries].reverse().find((e) => e.role === "assistant" && e.streaming);
    if (!live) {
      paintFull();
      return;
    }
    const node = transcriptEl.querySelector(`.msg.assistant[data-id="${CSS.escape(live.id)}"]`);
    if (!node) {
      paintFull();
      return;
    }
    const atBottom =
      transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 40;
    const body = node.querySelector(".body");
    if (body) {
      body.classList.remove("md");
      body.textContent = live.text || "";
    }
    let thinkingEl = node.querySelector(".thinking .body") as HTMLElement | null;
    if (live.thinking) {
      let wrap = node.querySelector(".thinking") as HTMLElement | null;
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "thinking";
        wrap.innerHTML = `<div class="role">Thinking</div><div class="body"></div>`;
        const bodyEl = node.querySelector(".body");
        if (bodyEl) {
          node.insertBefore(wrap, bodyEl);
        } else {
          node.appendChild(wrap);
        }
        thinkingEl = wrap.querySelector(".body");
      }
      if (thinkingEl) thinkingEl.textContent = live.thinking;
    }
    node.classList.add("streaming");
    updateEmptyChat();
    if (atBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function paintFull(): void {
    const entries = getEntries();
    const atBottom =
      transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 40;

    let html = "";
    for (const e of entries) {
      if (e.role === "user") {
        html += `<div class="msg user"><div class="role">You</div><div class="body">${escapeHtml(e.text)}</div></div>`;
      } else if (e.role === "assistant") {
        const thinking = e.thinking
          ? `<div class="thinking"><div class="role">Thinking</div><div class="body">${escapeHtml(e.thinking)}</div></div>`
          : "";
        const tool = e.toolName
          ? `<div class="tooltag">${escapeHtml(e.toolName)}</div>`
          : "";
        const cls = e.streaming ? "msg assistant streaming" : "msg assistant";
        const body = e.streaming
          ? escapeHtml(e.text || "")
          : e.text.trim()
            ? renderMarkdown(e.text)
            : "";
        const bodyClass = e.streaming ? "body" : "body md";
        html += `<div class="${cls}" data-id="${e.id}"><div class="role">Omp</div>${tool}${thinking}<div class="${bodyClass}">${body}</div></div>`;
      } else if (e.role === "tool") {
        const cls = e.isError ? "msg tool error" : "msg tool";
        html += `<div class="${cls}"><div class="role">Tool</div><div class="body">${escapeHtml(e.text)}</div></div>`;
      } else {
        const cls = e.isError ? "msg system error" : "msg system";
        html += `<div class="${cls}"><div class="body">${escapeHtml(e.text)}</div></div>`;
      }
    }
    transcriptEl.innerHTML = html;
    updateEmptyChat();
    if (atBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function schedulePaint(hint: TranscriptHint): void {
    if (hint.mode === "full") paintMode = "full";
    else if (!paintScheduled) paintMode = "stream";
    if (paintScheduled) return;
    paintScheduled = true;
    requestAnimationFrame(() => {
      paintScheduled = false;
      const mode = paintMode;
      paintMode = "full";
      if (mode === "stream") {
        paintLiveStream();
      } else {
        paintFull();
      }
    });
  }

  return {
    schedulePaint,
    paintFull,
    paintLiveStream,
    updateEmptyChat,
  };
}
