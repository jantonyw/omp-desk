import type { PlanTask } from "./client";
export type { PlanTask };

export function parsePlanTasksFromText(text: string): PlanTask[] {
  if (!text) return [];
  const lines = text.split("\n");
  const tasks: PlanTask[] = [];
  let index = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Match "- [ ] task", "- [x] task", "1. task", "* [ ] task"
    const checkboxMatch = /^[-*]\s*\[([ xX])\]\s*(.+)$/.exec(line);
    if (checkboxMatch) {
      tasks.push({
        id: `task-${index++}`,
        text: checkboxMatch[2]!.trim(),
        done: checkboxMatch[1]!.toLowerCase() === "x",
      });
      continue;
    }

    const numberedMatch = /^\d+\.\s*(.+)$/.exec(line);
    if (numberedMatch && (line.includes("step") || line.includes("Task") || line.includes("1.") || line.includes("2."))) {
      tasks.push({
        id: `task-${index++}`,
        text: numberedMatch[1]!.trim(),
        done: false,
      });
    }
  }

  return tasks;
}
