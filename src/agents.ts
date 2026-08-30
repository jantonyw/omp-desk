/**
 * Bundled omp task agents — the documented, spawnable subagent roster from
 * `oh-my-pi/packages/coding-agent/src/task/agents.ts` (prompts/agents/*.md).
 * These are subagent types invoked through the `task` tool, NOT slash
 * commands; the sidebar turns them into natural-language spawn instructions.
 */

export interface BundledTaskAgent {
  /** omp subagent type name used in the `task` tool / spawn instruction. */
  name: string;
  /** Short Chinese label shown next to the English name. */
  label: string;
  /** Compact icon glyph for the sidebar row. */
  icon: string;
  /** One-line description of what the agent specializes in. */
  description: string;
}

export const BUNDLED_TASK_AGENTS: BundledTaskAgent[] = [
  {
    name: "scout",
    label: "侦察",
    icon: "🔭",
    description: "只读侦察：快速探索代码库、定位相关代码与模式",
  },
  {
    name: "librarian",
    label: "检索",
    icon: "📚",
    description: "检索外部库与 API 源码，返回有据可查的答案",
  },
  {
    name: "reviewer",
    label: "审查",
    icon: "👁",
    description: "代码审查专家：质量与安全分析",
  },
  {
    name: "designer",
    label: "设计",
    icon: "🎨",
    description: "UI/UX 专家：设计实现、审查与视觉打磨",
  },
  {
    name: "security-reviewer",
    label: "安全审查",
    icon: "🛡",
    description: "只读安全专家：基于证据的漏洞发现",
  },
];

/** Composer prefix asking omp to spawn a bundled task agent via the `task` tool. */
export function buildAgentSpawnPrefix(agent: BundledTaskAgent): string {
  return `请使用 task 工具启动 ${agent.name} 子代理（${agent.label}）完成任务。任务：`;
}
