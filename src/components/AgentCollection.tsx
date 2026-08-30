import React, { useEffect, useState } from "react";
import {
  getAvailableCommandsCache,
  onCommandsChange,
  fetchAvailableCommands,
} from "../client";
import { BUNDLED_TASK_AGENTS, buildAgentSpawnPrefix } from "../agents";
import type { RpcAvailableSlashCommand } from "../protocol";

interface AgentCollectionProps {
  /** Insert a natural-language spawn instruction prefix into the composer. */
  onInsertSpawn: (text: string) => void;
  /** Insert a slash command (e.g. the omp `/agents` hub) into the composer. */
  onInsertSlash: (cmd: RpcAvailableSlashCommand) => void;
}

/** Find omp's `/agents` hub command (by name or alias) in the cached list. */
function findAgentsCommand(
  commands: RpcAvailableSlashCommand[]
): RpcAvailableSlashCommand | null {
  return (
    commands.find((c) => c.name === "agents" || c.aliases?.includes("agents")) ??
    null
  );
}

/**
 * 智能体集合 — visible roster of omp's bundled task agents in the
 * workspace/session sidebar. Drives omp's real `/agents` command when it is
 * exposed via `get_available_commands`; the five bundled agents are always
 * listed and insert a spawn instruction into the composer on click.
 */
export function AgentCollection({
  onInsertSpawn,
  onInsertSlash,
}: AgentCollectionProps): React.ReactElement {
  const [agentsCmd, setAgentsCmd] = useState<RpcAvailableSlashCommand | null>(
    () => findAgentsCommand(getAvailableCommandsCache())
  );
  const [open, setOpen] = useState<boolean>(true);

  useEffect(() => {
    const refresh = () =>
      setAgentsCmd(findAgentsCommand(getAvailableCommandsCache()));
    const unsub = onCommandsChange(refresh);
    // Commands may not have arrived yet; the roster stays visible regardless.
    if (getAvailableCommandsCache().length === 0) {
      void fetchAvailableCommands().catch(() => {
        // Ignore — hub entry stays hidden, roster-only list is still useful.
      });
    }
    return unsub;
  }, []);

  return (
    <section className="agent-collection" aria-label="智能体集合">
      <button
        type="button"
        className="agent-head"
        aria-expanded={open}
        title={open ? "折叠智能体集合" : "展开智能体集合"}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="agent-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="agent-title">智能体</span>
      </button>

      {open && (
        <div className="agent-body">
          {agentsCmd && (
            <button
              type="button"
              className="agent-row agent-hub"
              title={
                agentsCmd.description ||
                `${agentsCmd.name} — omp agents hub 命令`
              }
              onClick={() => onInsertSlash(agentsCmd)}
            >
              <span className="agent-icon" aria-hidden="true">
                🧭
              </span>
              <span className="agent-names">
                <span className="agent-label">Agents Hub</span>
                <span className="agent-name">/{agentsCmd.name}</span>
              </span>
              <span className="agent-plus" aria-hidden="true">
                +
              </span>
            </button>
          )}
          <ul className="agent-list" role="list">
            {BUNDLED_TASK_AGENTS.map((agent) => (
              <li key={agent.name}>
                <button
                  type="button"
                  className="agent-row"
                  title={`${agent.name} · ${agent.description}`}
                  onClick={() => onInsertSpawn(buildAgentSpawnPrefix(agent))}
                >
                  <span className="agent-icon" aria-hidden="true">
                    {agent.icon}
                  </span>
                  <span className="agent-names">
                    <span className="agent-label">{agent.label}</span>
                    <span className="agent-name">{agent.name}</span>
                  </span>
                  <span className="agent-plus" aria-hidden="true">
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
