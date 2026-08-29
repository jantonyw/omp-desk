import type { BoundModel } from "./client";
import { formatModelRef } from "./protocol";

const ROLE_LABELS = new Set(["default", "smol", "slow", "plan"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function modelRoleAnnotation(m: BoundModel): string {
  const found: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const low = v.toLowerCase();
    if (ROLE_LABELS.has(low)) found.push(low);
  };
  push(m.role);
  for (const r of m.roles ?? []) push(r);
  for (const t of m.tags ?? []) push(t);
  const extra = m as BoundModel & Record<string, unknown>;
  for (const key of ROLE_LABELS) {
    if (extra[key] === true) found.push(key);
  }
  return [...new Set(found)].join(", ");
}

export function chipLabel(m: BoundModel): string {
  const id = m.id;
  const provider = m.provider || "";
  if (provider && !id.toLowerCase().startsWith(provider.toLowerCase())) {
    return `${provider} · ${id}`;
  }
  return id;
}

export interface ModelSelectorElements {
  modelSelectEl: HTMLSelectElement;
  modelTabsEl: HTMLElement;
}

export interface ModelSelectorController {
  render: (models: BoundModel[], selectedRef: string) => void;
  setDisabled: (disabled: boolean) => void;
  syncActive: (selectedRef: string) => void;
}

export function initModelSelector(
  elements: ModelSelectorElements,
  onSelect: (provider: string, id: string, ref: string) => Promise<void> | void,
  isReadyAndIdle: () => boolean,
): ModelSelectorController {
  const { modelSelectEl, modelTabsEl } = elements;

  function setDisabled(disabled: boolean): void {
    modelSelectEl.disabled = disabled;
    for (const btn of modelTabsEl.querySelectorAll<HTMLButtonElement>(".model-chip")) {
      btn.disabled = disabled;
    }
  }

  function syncActive(selectedRef: string): void {
    for (const btn of modelTabsEl.querySelectorAll<HTMLButtonElement>(".model-chip")) {
      const ref = btn.dataset.ref ?? "";
      const on = ref === selectedRef;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function renderTabs(models: BoundModel[], selectedRef: string): void {
    const prefer = selectedRef || "";
    const byProvider = new Map<string, BoundModel[]>();
    for (const m of models) {
      const p = m.provider || "unknown";
      const list = byProvider.get(p);
      if (list) list.push(m);
      else byProvider.set(p, [m]);
    }

    const parts: string[] = [];
    const defaultActive = !prefer;
    parts.push(
      `<button type="button" class="model-chip${defaultActive ? " active" : ""}" role="tab" aria-selected="${
        defaultActive ? "true" : "false"
      }" data-ref="" title="omp default">omp default</button>`,
    );

    const providers = [...byProvider.keys()].sort((a, b) => a.localeCompare(b));
    for (const provider of providers) {
      parts.push(
        `<span class="model-provider-label" aria-hidden="true">${escapeHtml(provider)}</span>`,
      );
      const group = byProvider.get(provider)!;
      group.sort((a, b) => a.id.localeCompare(b.id));
      for (const m of group) {
        const ref = formatModelRef(m);
        const role = modelRoleAnnotation(m);
        const label = chipLabel(m);
        const title = role ? `${ref} (${role})` : ref;
        const active = prefer === ref;
        parts.push(
          `<button type="button" class="model-chip${active ? " active" : ""}" role="tab" aria-selected="${
            active ? "true" : "false"
          }" data-ref="${escapeHtml(ref)}" data-provider="${escapeHtml(m.provider)}" data-id="${escapeHtml(
            m.id,
          )}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`,
        );
      }
    }

    modelTabsEl.innerHTML = parts.join("");
  }

  function render(models: BoundModel[], selectedRef: string): void {
    const current = modelSelectEl.value;
    const prefer = selectedRef || current || "";

    const byProvider = new Map<string, BoundModel[]>();
    for (const m of models) {
      const p = m.provider || "unknown";
      const list = byProvider.get(p);
      if (list) list.push(m);
      else byProvider.set(p, [m]);
    }

    let html = `<option value="">omp default</option>`;
    const providers = [...byProvider.keys()].sort((a, b) => a.localeCompare(b));
    for (const provider of providers) {
      html += `<optgroup label="${escapeHtml(provider)}">`;
      const group = byProvider.get(provider)!;
      group.sort((a, b) => a.id.localeCompare(b.id));
      for (const m of group) {
        const ref = formatModelRef(m);
        const role = modelRoleAnnotation(m);
        const label = role ? `${ref} (${role})` : ref;
        html += `<option value="${escapeHtml(ref)}" data-provider="${escapeHtml(m.provider)}" data-id="${escapeHtml(
          m.id,
        )}">${escapeHtml(label)}</option>`;
      }
      html += `</optgroup>`;
    }
    modelSelectEl.innerHTML = html;
    if (prefer && [...modelSelectEl.options].some((o) => o.value === prefer)) {
      modelSelectEl.value = prefer;
    } else {
      modelSelectEl.value = "";
    }
    modelSelectEl.title = modelSelectEl.value || "omp default";
    renderTabs(models, modelSelectEl.value);
  }

  // Event wiring
  modelSelectEl.addEventListener("change", () => {
    if (!isReadyAndIdle()) return;
    const opt = modelSelectEl.selectedOptions[0];
    const ref = modelSelectEl.value;
    const provider = opt?.dataset.provider ?? "";
    const modelId = opt?.dataset.id ?? "";
    syncActive(ref);
    void onSelect(provider, modelId, ref);
  });

  modelTabsEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".model-chip") as HTMLButtonElement | null;
    if (!btn || btn.disabled || !isReadyAndIdle()) return;
    const ref = btn.dataset.ref ?? "";
    const provider = btn.dataset.provider ?? "";
    const modelId = btn.dataset.id ?? "";

    if ([...modelSelectEl.options].some((o) => o.value === ref)) {
      modelSelectEl.value = ref;
    } else {
      modelSelectEl.value = "";
    }
    modelSelectEl.title = ref || "omp default";
    syncActive(ref);
    void onSelect(provider, modelId, ref);
  });

  return {
    render,
    setDisabled,
    syncActive,
  };
}
