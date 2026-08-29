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

const MAX_HIGHLIGHT_LINES = 150;
const MAX_HIGHLIGHT_CHARS = 12000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function highlightCode(
  text: string,
  lang?: string
): { html: string; language: string; lineCount: number } {
  const lines = text.split("\n");
  const lineCount = lines.length;
  const rawLang = (lang || "").trim().toLowerCase();
  const language = rawLang && hljs.getLanguage(rawLang) ? rawLang : "";

  // For massive code blocks (> 150 lines or > 12KB), highlight visible head lines
  if (lineCount > MAX_HIGHLIGHT_LINES || text.length > MAX_HIGHLIGHT_CHARS) {
    const headLines = lines.slice(0, MAX_HIGHLIGHT_LINES).join("\n");
    const tailLines = lines.slice(MAX_HIGHLIGHT_LINES).join("\n");

    let headHtml = "";
    if (language) {
      try {
        headHtml = hljs.highlight(headLines, {
          language,
          ignoreIllegals: true,
        }).value;
      } catch {
        headHtml = escapeHtml(headLines);
      }
    } else {
      try {
        if (headLines.trim().startsWith("{") || headLines.trim().startsWith("[")) {
          headHtml = hljs.highlight(headLines, {
            language: "json",
            ignoreIllegals: true,
          }).value;
        } else {
          headHtml = hljs.highlightAuto(headLines).value;
        }
      } catch {
        headHtml = escapeHtml(headLines);
      }
    }

    const tailHtml = escapeHtml(tailLines);
    return {
      html: `${headHtml}\n${tailHtml}`,
      language: language || (text.trim().startsWith("{") ? "json" : "code"),
      lineCount,
    };
  }

  // Normal size code block: full AST syntax highlighting
  let highlighted = "";
  if (language) {
    try {
      highlighted = hljs.highlight(text, {
        language,
        ignoreIllegals: true,
      }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        highlighted = hljs.highlight(text, {
          language: "json",
          ignoreIllegals: true,
        }).value;
      } else if (
        trimmed.startsWith("diff --git") ||
        trimmed.startsWith("---") ||
        trimmed.includes("@@ -") ||
        trimmed.startsWith("File: ")
      ) {
        highlighted = hljs.highlight(text, {
          language: "diff",
          ignoreIllegals: true,
        }).value;
      } else {
        highlighted = hljs.highlightAuto(text).value;
      }
    } catch {
      highlighted = escapeHtml(text);
    }
  }

  return {
    html: highlighted,
    language: language || (text.trim().startsWith("{") ? "json" : "code"),
    lineCount,
  };
}

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const { html, language, lineCount } = highlightCode(text, lang);
  const linesTag =
    lineCount > 20
      ? `<span class="code-block-lines">${lineCount} lines</span>`
      : "";

  return `<div class="code-block-wrap">
    <div class="code-block-head">
      <div class="code-block-head-left">
        <span class="code-block-lang">${escapeHtml(language)}</span>
        ${linesTag}
      </div>
      <button type="button" class="code-block-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrap').querySelector('code').textContent)">Copy</button>
    </div>
    <pre><code class="hljs ${language ? `language-${language}` : ""}">${html}</code></pre>
  </div>`;
};

// Auto-detect and format file anchor code snippets e.g. [src/App.tsx#1201] or package.json#93F6
function formatFileCodeSnippets(text: string): string {
  if (!text) return "";

  // Quick check if text contains an anchor pattern like "file.ext#TAG"
  const hasFileAnchor = /\[?[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+#[a-zA-Z0-9]+\]?/.test(text);
  if (!hasFileAnchor) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let inSnippet = false;
  let snippetLines: string[] = [];
  let currentFile = "";

  const isAnchorHeader = (line: string): string | null => {
    const trimmed = line.trim();
    const m = /^\[?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+#[a-zA-Z0-9]+)\]?$/.exec(trimmed);
    return m ? m[1]! : null;
  };

  const flushSnippet = () => {
    if (inSnippet && snippetLines.length > 0) {
      const lang = guessLang(currentFile);
      output.push(`\n**📄 \`${currentFile}\`**\n`);
      output.push("```" + lang);
      output.push(snippetLines.join("\n"));
      output.push("```\n");
    }
    inSnippet = false;
    snippetLines = [];
    currentFile = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fileHeader = isAnchorHeader(line);

    if (fileHeader) {
      flushSnippet();
      inSnippet = true;
      currentFile = fileHeader;
      continue;
    }

    if (inSnippet) {
      const trimmed = line.trim();
      const isCodeLine =
        /^\s*\*?\d+:\s*.*/.test(line) ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed === "..." ||
        trimmed === "…" ||
        trimmed.startsWith("[…") ||
        trimmed.startsWith("[Showing") ||
        trimmed === "}" ||
        trimmed === "};" ||
        trimmed === "]" ||
        trimmed === "];" ||
        trimmed === ")" ||
        line.startsWith(" ") ||
        line.startsWith("\t") ||
        trimmed === "";

      if (isCodeLine) {
        snippetLines.push(line);
      } else {
        flushSnippet();
        output.push(line);
      }
    } else {
      output.push(line);
    }
  }

  flushSnippet();
  return output.join("\n");
}

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

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return getCachedOrRender(text, () => {
    const preprocessed = formatFileCodeSnippets(text);
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
