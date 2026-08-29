import type { RpcAvailableSlashCommand } from "./protocol";
import { getAvailableCommandsCache } from "./client";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function filterCommands(query: string): RpcAvailableSlashCommand[] {
  const q = query.replace(/^\//, "").toLowerCase();
  const all = getAvailableCommandsCache();
  if (!q) return all.slice(0, 40);
  return all
    .filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return true;
      if ((c.description ?? "").toLowerCase().includes(q)) return true;
      return false;
    })
    .slice(0, 40);
}

export interface SlashPaletteController {
  render: () => void;
  hide: () => void;
  isOpen: () => boolean;
  handleKeydown: (e: KeyboardEvent) => boolean;
  trigger: () => void;
}

export function initSlashPalette(
  composerEl: HTMLTextAreaElement,
  slashPaletteEl: HTMLElement,
  slashTriggerBtn?: HTMLButtonElement | null,
): SlashPaletteController {
  let slashIndex = -1;
  let slashFiltered: RpcAvailableSlashCommand[] = [];

  function hide(): void {
    slashIndex = -1;
    slashFiltered = [];
    slashPaletteEl.classList.add("hidden");
    slashPaletteEl.innerHTML = "";
    slashPaletteEl.setAttribute("aria-hidden", "true");
  }

  function isOpen(): boolean {
    return !slashPaletteEl.classList.contains("hidden") && slashFiltered.length > 0;
  }

  function insertCommand(cmd: RpcAvailableSlashCommand): void {
    const hint = cmd.input?.hint ? " " : "";
    composerEl.value = `/${cmd.name}${hint}`;
    hide();
    composerEl.focus();
    const len = composerEl.value.length;
    composerEl.setSelectionRange(len, len);
  }

  function render(): void {
    const text = composerEl.value;
    if (!text.startsWith("/") || text.includes("\n")) {
      hide();
      return;
    }
    const firstSpace = text.indexOf(" ");
    const query = firstSpace === -1 ? text : text.slice(0, firstSpace);
    if (firstSpace !== -1) {
      hide();
      return;
    }

    slashFiltered = filterCommands(query);
    if (slashFiltered.length === 0) {
      hide();
      return;
    }
    if (slashIndex < 0 || slashIndex >= slashFiltered.length) {
      slashIndex = 0;
    }

    slashPaletteEl.innerHTML = slashFiltered
      .map((c, i) => {
        const aliases = (c.aliases ?? []).length
          ? `<span class="slash-alias">${escapeHtml((c.aliases ?? []).map((a) => `/${a}`).join(" "))}</span>`
          : "";
        const desc = c.description
          ? `<span class="slash-desc">${escapeHtml(c.description)}</span>`
          : "";
        const hint = c.input?.hint
          ? `<span class="slash-hint">${escapeHtml(c.input.hint)}</span>`
          : "";
        const active = i === slashIndex ? " active" : "";
        return (
          `<button type="button" class="slash-item${active}" data-index="${i}" role="option" aria-selected="${
            i === slashIndex ? "true" : "false"
          }">` +
          `<span class="slash-name">/${escapeHtml(c.name)}</span>${aliases}${desc}${hint}` +
          `</button>`
        );
      })
      .join("");
    slashPaletteEl.classList.remove("hidden");
    slashPaletteEl.setAttribute("aria-hidden", "false");
  }

  function trigger(): void {
    if (!composerEl.value.startsWith("/")) {
      composerEl.value = `/${composerEl.value}`;
    }
    composerEl.focus();
    const len = composerEl.value.length;
    if (composerEl.value === "/") {
      composerEl.setSelectionRange(1, 1);
    } else {
      composerEl.setSelectionRange(len, len);
    }
    render();
  }

  // Bind DOM events
  slashPaletteEl.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Prevent composer blur
  });

  slashPaletteEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".slash-item") as HTMLElement | null;
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    const cmd = slashFiltered[idx];
    if (cmd) insertCommand(cmd);
  });

  if (slashTriggerBtn) {
    slashTriggerBtn.addEventListener("click", trigger);
  }

  composerEl.addEventListener("input", () => {
    render();
  });

  function handleKeydown(e: KeyboardEvent): boolean {
    if (!isOpen()) return false;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashIndex = (slashIndex + 1) % slashFiltered.length;
      render();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      slashIndex = (slashIndex - 1 + slashFiltered.length) % slashFiltered.length;
      render();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
      if (cmd) insertCommand(cmd);
      return true;
    }
    return false;
  }

  return {
    render,
    hide,
    isOpen,
    handleKeydown,
    trigger,
  };
}
