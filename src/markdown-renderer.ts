import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";

const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
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
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "details",
  "summary",
  "button",
  "svg",
  "path",
];

const ALLOWED_ATTR = [
  "href",
  "title",
  "target",
  "rel",
  "class",
  "data-id",
  "data-lang",
  "aria-hidden",
  "viewBox",
  "fill",
  "d",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
];

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  let highlighted = "";

  if (language) {
    try {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        highlighted = hljs.highlight(text, { language: "json", ignoreIllegals: true }).value;
      } else if (
        trimmed.startsWith("diff --git") ||
        trimmed.startsWith("---") ||
        trimmed.includes("@@ -") ||
        trimmed.startsWith("File: ")
      ) {
        highlighted = hljs.highlight(text, { language: "diff", ignoreIllegals: true }).value;
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
    } catch {
      highlighted = escapeHtml(text);
    }
  }

  const langLabel = language || (text.trim().startsWith("{") ? "json" : "code");

  return `<div class="code-block-wrap">
    <div class="code-block-head">
      <span class="code-block-lang">${escapeHtml(langLabel)}</span>
      <button type="button" class="code-block-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrap').querySelector('code').textContent)">Copy</button>
    </div>
    <pre><code class="hljs ${language ? `language-${language}` : ""}">${highlighted}</code></pre>
  </div>`;
};

// Cache for rendered Markdown HTML (LRU cache up to 500 items)
const renderCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

function getCachedOrRender(key: string, fn: () => string): string {
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  const result = fn();
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value;
    if (firstKey) renderCache.delete(firstKey);
  }
  renderCache.set(key, result);
  return result;
}

function guessLang(fileName: string): string {
  const clean = fileName.split("#")[0] || "";
  const ext = clean.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json":
      return "json";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "vue":
    case "html":
      return "html";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "bash";
    default:
      return "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Format omp tool output chunks into clean codeblocks without over-fragmentation
function formatOmpSnippets(text: string): string {
  if (!text) return "";

  // If text already has code fences, don't modify it
  if (text.includes("```")) {
    return text;
  }

  // 1. Detect Git diff chunks
  if (
    text.includes("--- Changes ---") ||
    text.includes("diff --git") ||
    (text.includes("@@ -") && text.includes("@@ +"))
  ) {
    return "```diff\n" + text + "\n```";
  }

  // 2. Detect ESLint / terminal build output
  if (
    (/\d+:\d+:\s+(warning|error)/.test(text) || text.includes("✖ ") || text.includes("problems (")) &&
    text.includes("Wall time:")
  ) {
    return "```bash\n" + text + "\n```";
  }

  // 3. Detect file anchor headers like [package.json#93F6] or package.json#93F6 followed by line numbers
  const fileHeaderPattern = /^(?:\[)?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+(?:#[A-Za-z0-9]+)?)(?:\])?\s*$/m;
  if (fileHeaderPattern.test(text)) {
    const lines = text.split("\n");
    const formatted: string[] = [];
    let inSnippet = false;
    let snippetLines: string[] = [];
    let currentFileName = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      const match = /^(?:\[)?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+(?:#[A-Za-z0-9]+)?)(?:\])?$/.exec(trimmed);

      if (match) {
        if (inSnippet && snippetLines.length > 0) {
          formatted.push("```" + guessLang(currentFileName) + "\n" + snippetLines.join("\n") + "\n```\n");
          snippetLines = [];
        }
        inSnippet = true;
        currentFileName = match[1]!;
        formatted.push(`\n**📄 \`${currentFileName}\`**\n`);
        continue;
      }

      if (inSnippet) {
        // Keep snippet lines together (including ellipsis '...', line numbers '12:', code rows, and blanks)
        const isSnippetLine =
          /^\s*\*?\d+:\s*.*/.test(line) ||
          trimmed === "..." ||
          trimmed === "…" ||
          trimmed.startsWith("[…") ||
          trimmed.startsWith("[Showing") ||
          line.startsWith(" ") ||
          line.startsWith("\t") ||
          trimmed === "";

        if (isSnippetLine) {
          snippetLines.push(line);
        } else {
          // Non-snippet line encountered (e.g. explanations or markdown headings)
          if (snippetLines.length > 0) {
            formatted.push("```" + guessLang(currentFileName) + "\n" + snippetLines.join("\n") + "\n```\n");
            snippetLines = [];
          }
          inSnippet = false;
          formatted.push(line);
        }
      } else {
        formatted.push(line);
      }
    }

    if (inSnippet && snippetLines.length > 0) {
      formatted.push("```" + guessLang(currentFileName) + "\n" + snippetLines.join("\n") + "\n```\n");
    }

    return formatted.join("\n");
  }

  return text;
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return getCachedOrRender(text, () => {
    const preprocessed = formatOmpSnippets(text);
    const raw = marked.parse(preprocessed, {
      renderer,
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });
  });
}
