import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  getStatus,
  startSession,
  stopSession,
  sendPrompt,
  abort,
  getEntries,
  onTranscriptChange,
  getChangedFiles,
  clearChangedFiles,
  onChangesChange,
  getPlanTasks,
  setPlanTasks,
  togglePlanTask,
  onPlanTasksChange,
  getAvailableModelsCache,
  onModelsChange,
  onCommandsChange,
  setModel,
  fetchAvailableModels,
  fetchAvailableCommands,
  fetchSessionState,
  promptOrAbortAndPrompt,
  getLastAssistantText,
  parsePlanSteps,
  subscribeEvents,
  handleEvent,
  formatModelRef,
  PLAN_PREFIX,
  EXECUTE_PREFIX,
  stripMarkdownEmphasis,
  type Status,
  type Settings,
  type TranscriptEntry,
  type ChangedFile,
  type PlanTask,
} from "./client";
import type { BoundModel, RpcAvailableSlashCommand, RpcEventPayload } from "./protocol";
import { loadTheme, saveTheme, applyTheme, type ThemeId } from "./theme";
import { loadSettings, saveSettings } from "./settings";
import { filterCommands } from "./slash-palette";

// Subcomponents
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { IdeSidePanel } from "./components/IdeSidePanel";
import { SessionsPane } from "./components/SessionsPane";
import { ChatPane } from "./components/ChatPane";
import { InspectorPane } from "./components/InspectorPane";

export function App(): React.ReactElement {
  // Theme state
  const [theme, setThemeState] = useState<ThemeId>(loadTheme);

  // Settings & Status state
  const [settings, setSettings] = useState<Settings>(() => ({
    ompPath: "omp",
    cwd: "/workspace",
    model: "",
    noSession: false,
    noSkills: false,
    noRules: false,
    extraArgs: "",
  }));
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>({
    started: false,
    running: false,
    ready: false,
    protocol_version: 1,
    is_streaming: false,
    message_count: 0,
    exited: false,
  });

  // IDE side panel state
  const [sideOpen, setSideOpen] = useState<boolean>(true);
  const [activeView, setActiveView] = useState<"explorer" | "scm" | "browser">("explorer");

  // Mode & Prompt state
  const [workMode, setWorkMode] = useState<"plan" | "execute">("plan");
  const [composerText, setComposerText] = useState<string>("");
  const [lastPlanText, setLastPlanText] = useState<string>("");
  const [selectingModel, setSelectingModel] = useState<boolean>(false);
  const [activeModelRef, setActiveModelRef] = useState<string>("");

  // Store data state
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [changes, setChanges] = useState<ChangedFile[]>([]);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [models, setModels] = useState<BoundModel[]>([]);

  // Slash commands state
  const [slashOpen, setSlashOpen] = useState<boolean>(false);
  const [slashIndex, setSlashIndex] = useState<number>(0);
  const [slashFiltered, setSlashFiltered] = useState<RpcAvailableSlashCommand[]>([]);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLElement>(null);

  const appendSystem = useCallback((text: string) => {
    handleEvent({ kind: "stderr", text });
  }, []);

  const bumpMessageCount = useCallback(() => {
    setStatus((prev) => ({
      ...prev,
      message_count: (prev.message_count || 0) + 1,
    }));
  }, []);

  const refreshMessageCount = useCallback(async () => {
    try {
      await fetchSessionState();
      const st = await getStatus();
      setStatus((prev) => ({
        ...st,
        message_count: Math.max(st.message_count || 0, prev.message_count || 0),
      }));
      if (st.model) {
        setActiveModelRef((prev) =>
          st.model?.includes("/") ? st.model : prev || st.model || ""
        );
      }
    } catch {
      // get_state may fail mid-exit
    }
  }, []);

  const onReadyLoadModels = useCallback(async () => {
    try {
      const availModels = await fetchAvailableModels();
      const st = await getStatus();
      setStatus(st);
      if (st.model) setActiveModelRef(st.model);
      if (settings.model) {
        const match = availModels.find((m) => formatModelRef(m) === settings.model);
        if (match && activeModelRef !== settings.model) {
          try {
            const updated = await setModel(match.provider, match.id);
            setActiveModelRef(formatModelRef(updated) || settings.model);
          } catch {
            // Keep listing
          }
        }
      }
    } catch (err) {
      appendSystem(`[models] ${String(err)}`);
    }
    try {
      await fetchAvailableCommands();
    } catch (err) {
      appendSystem(`[commands] ${String(err)}`);
    }
    await refreshMessageCount();
  }, [settings.model, activeModelRef, appendSystem, refreshMessageCount]);

  const capturePlanFromTranscript = useCallback(() => {
    const text = getLastAssistantText();
    if (!text.trim()) return;
    setLastPlanText(text);
    const steps = parsePlanSteps(text).map((t) => ({
      ...t,
      text: stripMarkdownEmphasis(t.text),
    }));
    if (steps.length > 0) setPlanTasks(steps);
  }, []);

  const onRpcEvent = useCallback(
    (ev: RpcEventPayload) => {
      handleEvent(ev);

      if (ev.kind === "ready") {
        void getStatus().then((s) => {
          setStatus(s);
          if (s.model) setActiveModelRef(s.model);
        });
        void onReadyLoadModels();
      }

      if (ev.kind === "exited") {
        void getStatus().then((s) => {
          setStatus(s);
        });
        setSlashOpen(false);
      }

      if (ev.kind === "response") {
        const f = ev.frame as { command?: string; success?: boolean; data?: unknown } | undefined;
        if (
          f?.command === "get_state" ||
          f?.command === "set_model" ||
          f?.command === "cycle_model"
        ) {
          void getStatus().then((s) => {
            setStatus(s);
            if (s.model) setActiveModelRef(s.model.includes("/") ? s.model : s.model || "");
            if (f.command === "set_model" && f.success && f.data) {
              const m = f.data as BoundModel;
              const ref = formatModelRef(m);
              if (ref) setActiveModelRef(ref);
            }
          });
        }
      }

      if (ev.kind === "event") {
        const f = ev.frame as { type?: string } | undefined;
        if (f?.type === "agent_end") {
          void refreshMessageCount();
          if (workMode === "plan") {
            queueMicrotask(() => capturePlanFromTranscript());
          }
        }
        if (f?.type === "agent_start" || f?.type === "tool_execution_start") {
          void getStatus().then((s) => {
            setStatus(s);
          });
        }
        if (f?.type === "session_info_update" || f?.type === "config_update") {
          void refreshMessageCount();
        }
      }
    },
    [onReadyLoadModels, refreshMessageCount, workMode, capturePlanFromTranscript]
  );

  const doStart = useCallback(
    async (sToStart?: Settings) => {
      const s = sToStart || settings;
      setActiveModelRef(s.model);
      setLastPlanText("");
      setSlashOpen(false);
      try {
        const st = await startSession(s);
        setStatus(st);
      } catch (err) {
        appendSystem(`[start failed] ${String(err)}`);
        const fallback = await getStatus().catch(() => status);
        setStatus({ ...fallback, started: false });
      }
    },
    [settings, appendSystem, status]
  );

  // Initialize
  useEffect(() => {
    applyTheme(theme);

    void (async () => {
      const s = await loadSettings();
      setSettings(s);
      setActiveModelRef(s.model);
      await doStart(s);
    })();

    const unsubTranscript = onTranscriptChange(() => {
      setEntries([...getEntries()]);
    });
    const unsubChanges = onChangesChange(() => {
      setChanges([...getChangedFiles()]);
    });
    const unsubPlan = onPlanTasksChange(() => {
      setTasks([...getPlanTasks()]);
    });
    const unsubModels = onModelsChange(() => {
      setModels([...getAvailableModelsCache()]);
    });
    const unsubCommands = onCommandsChange(() => {
      if (composerRef.current?.value.startsWith("/")) {
        const matched = filterCommands(composerRef.current.value);
        setSlashFiltered(matched);
      }
    });

    let unsubEvents: (() => void) | undefined;
    void subscribeEvents(onRpcEvent).then((unsub) => {
      unsubEvents = unsub;
    });

    return () => {
      unsubTranscript();
      unsubChanges();
      unsubPlan();
      unsubModels();
      unsubCommands();
      unsubEvents?.();
    };
  }, []);

  const handleThemeChange = (newTheme: ThemeId) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
    applyTheme(newTheme);
  };

  const handleApplySettings = async (newSettings: Settings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
    setSettingsOpen(false);
    await doStart(newSettings);
  };

  const handleSelectModel = async (ref: string, provider?: string, modelId?: string) => {
    if (!status.ready || selectingModel) return;

    if (!ref) {
      const updatedSettings = { ...settings, model: "" };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
      setActiveModelRef(status.model || "");
      appendSystem(
        "[models] omp default selected for next spawn (omit --model). Active session model unchanged."
      );
      return;
    }

    if (!provider || !modelId) return;

    const prevRef = activeModelRef;
    setSelectingModel(true);
    try {
      const updated = await setModel(provider, modelId);
      const newRef = formatModelRef(updated) || ref;
      setActiveModelRef(newRef);
      const updatedSettings = { ...settings, model: newRef };
      setSettings(updatedSettings);
      saveSettings(updatedSettings);
      const st = await getStatus().catch(() => status);
      if (st.model) {
        setActiveModelRef(st.model.includes("/") ? st.model : newRef);
      }
    } catch (err) {
      setActiveModelRef(prevRef);
      appendSystem(`[set_model failed] ${String(err)}`);
    } finally {
      setSelectingModel(false);
    }
  };

  const handleSend = () => {
    const text = composerText;
    if (!text.trim()) return;

    if (slashOpen && slashFiltered.length > 0) {
      const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
      if (cmd) {
        handleInsertSlash(cmd);
        return;
      }
    }

    setComposerText("");
    setSlashOpen(false);

    const isSlash = text.trimStart().startsWith("/");
    if (isSlash) {
      bumpMessageCount();
      void promptOrAbortAndPrompt(text, status.is_streaming).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    if (workMode === "plan") {
      const payload = PLAN_PREFIX + text;
      bumpMessageCount();
      void sendPrompt(payload).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    if (!lastPlanText.trim()) {
      bumpMessageCount();
      void sendPrompt(text).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    const ok = window.confirm(
      "Execute mode: send this message to implement (omp will apply changes). Continue?"
    );
    if (!ok) {
      setComposerText(text);
      return;
    }
    bumpMessageCount();
    void promptOrAbortAndPrompt(
      EXECUTE_PREFIX + text + "\n\nApproved plan:\n" + lastPlanText,
      status.is_streaming
    ).catch((err) => appendSystem(`[send failed] ${String(err)}`));
  };

  const handleConfirmExecute = async () => {
    if (!lastPlanText.trim()) {
      appendSystem("[execute] No plan captured yet. Run a Plan turn first.");
      return;
    }
    const ok = window.confirm(
      "Execute the captured plan? omp will apply file-changing tools."
    );
    if (!ok) return;
    setWorkMode("execute");
    const message =
      EXECUTE_PREFIX +
      "Approved plan:\n" +
      lastPlanText +
      (tasks.length
        ? "\n\nSteps:\n" + tasks.map((t, i) => `${i + 1}. ${t.text}`).join("\n")
        : "");
    bumpMessageCount();
    try {
      await promptOrAbortAndPrompt(message, status.is_streaming);
    } catch (err) {
      appendSystem(`[execute failed] ${String(err)}`);
    }
  };

  const handleComposerChange = (text: string) => {
    setComposerText(text);
    if (text.startsWith("/") && !text.includes("\n")) {
      const firstSpace = text.indexOf(" ");
      const query = firstSpace === -1 ? text : text.slice(0, firstSpace);
      if (firstSpace === -1) {
        const matched = filterCommands(query);
        setSlashFiltered(matched);
        setSlashOpen(matched.length > 0);
        setSlashIndex(0);
        return;
      }
    }
    setSlashOpen(false);
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashFiltered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % slashFiltered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + slashFiltered.length) % slashFiltered.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
        if (cmd) handleInsertSlash(cmd);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
        if (cmd) handleInsertSlash(cmd);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSlashTrigger = () => {
    let nextText = composerText;
    if (!nextText.startsWith("/")) {
      nextText = `/${nextText}`;
    }
    setComposerText(nextText);
    composerRef.current?.focus();
    const matched = filterCommands(nextText);
    setSlashFiltered(matched);
    setSlashOpen(matched.length > 0);
    setSlashIndex(0);
  };

  const handleInsertSlash = (cmd: RpcAvailableSlashCommand) => {
    const hint = cmd.input?.hint ? " " : "";
    setComposerText(`/${cmd.name}${hint}`);
    setSlashOpen(false);
    composerRef.current?.focus();
  };

  // Status Bar text
  const modelLabel = activeModelRef || status.model || "omp default";
  const visibleStatus: string[] = [];
  const fullTipStatus: string[] = [];

  if (!status.started) {
    visibleStatus.push("not started");
    fullTipStatus.push("not started");
  } else {
    const state = !status.running
      ? status.exited
        ? "exited"
        : "stopped"
      : status.is_streaming
      ? "streaming"
      : status.ready
      ? "ready"
      : "starting…";
    visibleStatus.push(state);
    fullTipStatus.push(state);
    if (status.pid != null) fullTipStatus.push(`pid ${status.pid}`);
    visibleStatus.push(modelLabel);
    fullTipStatus.push(modelLabel);
    visibleStatus.push(`${status.message_count} msgs`);
    fullTipStatus.push(`${status.message_count} msgs`);
    if (status.session_id) {
      const short = `#${status.session_id.slice(0, 8)}`;
      visibleStatus.push(short);
      fullTipStatus.push(short);
    }
    visibleStatus.push(workMode === "plan" ? "Plan" : "Execute");
    fullTipStatus.push(workMode === "plan" ? "mode:plan" : "mode:execute");
  }

  return (
    <div id="app">
      <TopBar
        theme={theme}
        settingsOpen={settingsOpen}
        onThemeChange={handleThemeChange}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
      />

      <SettingsPanel
        isOpen={settingsOpen}
        settings={settings}
        onApply={handleApplySettings}
      />

      <div id="studio" className={sideOpen ? "" : "side-closed"}>
        <IdeSidePanel
          sideOpen={sideOpen}
          activeView={activeView}
          workspaceRoot={settings.cwd}
          onSelectView={setActiveView}
          onToggleSide={() => setSideOpen((prev) => !prev)}
        />

        <SessionsPane
          status={status}
          cwd={settings.cwd}
          activeModelRef={activeModelRef}
          onNewSession={() => void doStart()}
          onStopSession={() =>
            void stopSession().then(async () => {
              const st = await getStatus();
              setStatus(st);
            })
          }
        />

        <ChatPane
          workMode={workMode}
          entries={entries}
          composerText={composerText}
          isStreaming={status.is_streaming}
          canSend={status.ready}
          models={models}
          activeModelRef={activeModelRef}
          selectingModel={selectingModel}
          isReady={status.ready}
          slashOpen={slashOpen}
          slashIndex={slashIndex}
          slashFiltered={slashFiltered}
          composerRef={composerRef}
          transcriptRef={transcriptRef}
          onSetWorkMode={setWorkMode}
          onComposerChange={handleComposerChange}
          onComposerKeyDown={handleComposerKeyDown}
          onSlashTrigger={handleSlashTrigger}
          onInsertSlash={handleInsertSlash}
          onSend={handleSend}
          onAbort={() => void abort()}
          onSelectModel={handleSelectModel}
          onRefreshModels={onReadyLoadModels}
        />

        <InspectorPane
          changes={changes}
          tasks={tasks}
          hasPlanInChat={Boolean(lastPlanText.trim())}
          canConfirmExecute={status.ready && Boolean(lastPlanText.trim())}
          isStreaming={status.is_streaming}
          onClearChanges={clearChangedFiles}
          onConfirmExecute={handleConfirmExecute}
          onToggleTask={togglePlanTask}
          onNewSession={() => void doStart()}
          onAbort={() => void abort()}
        />
      </div>

      <div id="status-bar" title={fullTipStatus.join(" · ")}>
        {visibleStatus.join(" · ")}
      </div>
    </div>
  );
}
