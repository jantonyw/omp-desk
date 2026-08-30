import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  getStatus,
  startSession,
  sendPrompt,
  abort,
  getEntries,
  appendUser,
  clearTranscript,
  onTranscriptChange,
  getChangedFiles,
  clearChangedFiles,
  onChangesChange,
  getPlanTasks,
  setPlanTasks,
  clearPlanTasks,
  setTranscriptEntries,
  togglePlanTask,
  onPlanTasksChange,
  getAvailableModelsCache,
  onModelsChange,
  onCommandsChange,
  setModel,
  fetchAvailableModels,
  fetchAvailableCommands,
  fetchSessionState,
  fetchWorkspaceGroups,
  fetchSessionTranscript,
  promptOrAbortAndPrompt,
  getLastAssistantText,
  parsePlanSteps,
  subscribeEvents,
  handleEvent,
  formatModelRef,
  PLAN_PREFIX,
  EXECUTE_PREFIX,
  stripMarkdownEmphasis,
  onExtensionUiRequest,
  respondExtensionUi,
  type Status,
  type Settings,
  type TranscriptEntry,
  type ChangedFile,
  type PlanTask,
  type WorkspaceGroup,
  type SessionHistoryEntry,
} from "./client";
import type { BoundModel, RpcAvailableSlashCommand, RpcEventPayload, ExtensionUiRequest } from "./protocol";
import { loadTheme, saveTheme, applyTheme, type ThemeId } from "./theme";
import { loadSettings, saveSettings } from "./settings";
import { filterCommands } from "./slash-palette";

const ACTIVE_SESSION_KEY = "omp-desk.active-session";

type StoredActiveSession = {
  id: string;
  filePath: string;
  cwd: string;
};

function loadActiveSession(): StoredActiveSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredActiveSession>;
    if (typeof value.id !== "string" || typeof value.filePath !== "string" || typeof value.cwd !== "string") {
      return null;
    }
    return { id: value.id, filePath: value.filePath, cwd: value.cwd };
  } catch {
    return null;
  }
}

function saveActiveSession(session: StoredActiveSession): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

function clearActiveSession(): void {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

// Subcomponents
import { TopBar } from "./components/TopBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { IdeSidePanel } from "./components/IdeSidePanel";
import { SessionsPane } from "./components/SessionsPane";
import { ChatPane } from "./components/ChatPane";
import { InspectorPane } from "./components/InspectorPane";
import { PermissionDialog } from "./components/PermissionDialog";
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
  const [workMode, setWorkMode] = useState<"chat" | "plan" | "execute">("chat");
  const [composerText, setComposerText] = useState<string>("");
  const [lastPlanText, setLastPlanText] = useState<string>("");
  const [selectingModel, setSelectingModel] = useState<boolean>(false);
  const [activeModelRef, setActiveModelRef] = useState<string>("");

  // Store data state
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [changes, setChanges] = useState<ChangedFile[]>([]);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [models, setModels] = useState<BoundModel[]>([]);
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroup[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // Slash commands state
  const [slashOpen, setSlashOpen] = useState<boolean>(false);
  const [slashIndex, setSlashIndex] = useState<number>(0);
  const [slashFiltered, setSlashFiltered] = useState<RpcAvailableSlashCommand[]>([]);

  // Interactive extension UI / permission request state
  const [activeUiRequest, setActiveUiRequest] = useState<ExtensionUiRequest | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<Settings>(settings);

  const updateSettings = useCallback((nextSettings: Settings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }, []);

  const appendSystem = useCallback((text: string) => {
    handleEvent({ kind: "stderr", text });
  }, []);

  const bumpMessageCount = useCallback(() => {
    setStatus((prev) => ({
      ...prev,
      message_count: (prev.message_count || 0) + 1,
    }));
  }, []);

  const loadWorkspaces = useCallback(async (sessionId?: string) => {
    try {
      const groups = await fetchWorkspaceGroups();
      setWorkspaceGroups(groups);

      // Session JSONL is the source of truth for its workspace. Align the
      // selected workspace after a reload so the active record opens in the
      // group where OMP actually stored it instead of remaining hidden in a
      // previously selected workspace.
      if (sessionId) {
        const session = groups
          .flatMap((group) => group.sessions)
          .find((item) => item.id === sessionId);
        if (session?.cwd && session.cwd !== settingsRef.current.cwd) {
          const nextSettings = { ...settingsRef.current, cwd: session.cwd };
          updateSettings(nextSettings);
          saveSettings(nextSettings);
        }
      }
    } catch {
      // Ignore if session directory not ready
    }
  }, [updateSettings]);

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
      if (st.session_id) {
        setActiveSessionId(st.session_id);
        if (st.session_file) {
          saveActiveSession({ id: st.session_id, filePath: st.session_file, cwd: settingsRef.current.cwd });
        }
      }
    } catch {
      // get_state may fail mid-exit
    }
  }, []);

  const onReadyLoadModels = useCallback(async () => {
    let currentStatus: Status | undefined;
    // Persist the session identity before model discovery: model RPC calls can
    // take time, while a reload immediately after creating a session must not
    // lose its resume target.
    await refreshMessageCount();

    try {
      const availModels = await fetchAvailableModels();
      const st = await getStatus();
      currentStatus = st;
      setStatus(st);
      if (st.model) setActiveModelRef(st.model);
      if (st.session_id) {
        setActiveSessionId(st.session_id);
        if (st.session_file) {
          saveActiveSession({ id: st.session_id, filePath: st.session_file, cwd: settingsRef.current.cwd });
        }
      }
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
    } catch {
      // Background preload; ignore timeout if child is busy initializing
    }
    void loadWorkspaces(currentStatus?.session_id);
  }, [settings.model, activeModelRef, appendSystem, refreshMessageCount, loadWorkspaces]);

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
          if (s.session_id) {
            setActiveSessionId(s.session_id);
            if (s.session_file) {
              saveActiveSession({ id: s.session_id, filePath: s.session_file, cwd: settingsRef.current.cwd });
            }
          }
          void loadWorkspaces(s.session_id);
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
            if (s.session_id) {
              setActiveSessionId(s.session_id);
              if (s.session_file) {
                saveActiveSession({ id: s.session_id, filePath: s.session_file, cwd: settingsRef.current.cwd });
              }
            }
            if (f.command === "set_model" && f.success && f.data) {
              const m = f.data as BoundModel;
              const ref = formatModelRef(m);
              if (ref) setActiveModelRef(ref);
            }
            void loadWorkspaces(s.session_id);
          });
        }
      }

      if (ev.kind === "event") {
        const f = ev.frame as { type?: string } | undefined;
        if (f?.type === "agent_end") {
          void refreshMessageCount();
          void getStatus().then((s) => void loadWorkspaces(s.session_id));
          if (workMode === "plan") {
            queueMicrotask(() => capturePlanFromTranscript());
          }
        }
        if (f?.type === "agent_start" || f?.type === "tool_execution_start") {
          void getStatus().then((s) => {
            setStatus(s);
          });
        }
        if (f?.type === "session_info_update") {
          void refreshMessageCount();
          void getStatus().then((s) => void loadWorkspaces(s.session_id));
        }
        if (f?.type === "config_update") {
          void refreshMessageCount();
        }
      }
    },
    [onReadyLoadModels, refreshMessageCount, loadWorkspaces, workMode, capturePlanFromTranscript]
  );

  const doStart = useCallback(
    async (sToStart?: Settings, resume?: string) => {
      const s = sToStart || settings;
      setActiveModelRef(s.model);
      setLastPlanText("");
      setSlashOpen(false);
      clearTranscript();
      clearChangedFiles();
      clearPlanTasks();
      try {
        const st = await startSession(s, resume);
        setStatus(st);
        if (st.session_id) {
          setActiveSessionId(st.session_id);
          if (st.session_file) {
            saveActiveSession({ id: st.session_id, filePath: st.session_file, cwd: s.cwd });
          }
        }
        void loadWorkspaces(st.session_id);
      } catch (err) {
        appendSystem(`[start failed] ${String(err)}`);
        const fallback = await getStatus().catch(() => status);
        setStatus({ ...fallback, started: false });
      }
    },
    [settings, appendSystem, status, loadWorkspaces]
  );

  const loadSessionTranscript = useCallback(async (sessionId: string, filePath: string) => {
    try {
      const rawMessages = await fetchSessionTranscript(filePath);
      const transcriptMessages: TranscriptEntry[] = rawMessages.map((m, idx) => ({
        id: `hist-${sessionId}-${idx}`,
        role: m.role === "user" ? "user" : m.role === "tool" ? "tool" : "assistant",
        text: m.text,
        toolName: m.tool_name,
        isError: m.is_error,
      }));

      // Phase 1 (Instant 0ms): For large sessions, mount the bottom 16 first so clicking is instant
      if (transcriptMessages.length > 16) {
        setTranscriptEntries(transcriptMessages.slice(-16));
        // Phase 2: Hydrate full list in next tick without freezing the UI frame
        setTimeout(() => {
          setTranscriptEntries(transcriptMessages);
        }, 50);
      } else {
        setTranscriptEntries(transcriptMessages);
      }
    } catch (err) {
      appendSystem(`[load history failed] ${String(err)}`);
    }
  }, [appendSystem]);

  // Initialize
  useEffect(() => {
    applyTheme(theme);

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
    let eventsCancelled = false;
    const eventsReady = subscribeEvents(onRpcEvent)
      .then((unsub) => {
        if (eventsCancelled) {
          unsub();
          return false;
        }
        unsubEvents = unsub;
        return true;
      })
      .catch((err) => {
        if (!eventsCancelled) {
          appendSystem(`[event subscription failed] ${String(err)}`);
        }
        return !eventsCancelled;
      });

    void (async () => {
      const listening = await eventsReady;
      if (!listening || eventsCancelled) return;

      const s = await loadSettings();
      if (eventsCancelled) return;
      const savedSession = loadActiveSession();
      const initialSettings = savedSession && savedSession.cwd !== s.cwd
        ? { ...s, cwd: savedSession.cwd }
        : s;
      updateSettings(initialSettings);
      setActiveModelRef(initialSettings.model);

      // Refreshing the WebView does not restart the Rust backend. Reuse its
      // existing OMP child instead of killing it with another start_session.
      const existingStatus = await getStatus();
      if (existingStatus.started && existingStatus.running && !existingStatus.exited) {
        setStatus(existingStatus);
        if (existingStatus.model) {
          setActiveModelRef(existingStatus.model);
        }

        const sessionId = existingStatus.session_id ?? savedSession?.id;
        const filePath = existingStatus.session_file ?? savedSession?.filePath;
        if (sessionId && filePath) {
          setActiveSessionId(sessionId);
          saveActiveSession({ id: sessionId, filePath, cwd: initialSettings.cwd });
          await loadSessionTranscript(sessionId, filePath);
        }
        await loadWorkspaces(sessionId);
        return;
      }

      if (savedSession) {
        setActiveSessionId(savedSession.id);
      }
      await doStart(initialSettings, savedSession?.filePath);
      if (savedSession && !eventsCancelled) {
        await loadSessionTranscript(savedSession.id, savedSession.filePath);
      }
    })();

    const unsubUi = onExtensionUiRequest((req) => {
      if (req.method === "cancel") {
        setActiveUiRequest((cur) => (cur && cur.id === req.targetId ? null : cur));
        return;
      }
      setActiveUiRequest(req);
    });

    return () => {
      eventsCancelled = true;
      unsubTranscript();
      unsubChanges();
      unsubPlan();
      unsubModels();
      unsubCommands();
      unsubUi();
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
    updateSettings(newSettings);
    setSettingsOpen(false);
    await doStart(newSettings);
  };

  const handleSelectWorkspace = async (newPath: string) => {
    if (!newPath || newPath === settings.cwd) return;
    const nextSettings = { ...settings, cwd: newPath };
    updateSettings(nextSettings);
    saveSettings(nextSettings);
    await doStart(nextSettings);
  };

  const handleAddWorkspace = () => {
    const input = window.prompt("请输入新工作区的绝对路径 (Absolute folder path):", settings.cwd);
    if (input && input.trim()) {
      void handleSelectWorkspace(input.trim());
    }
  };

  const handleSelectModel = async (ref: string, provider?: string, modelId?: string) => {
    if (!status.ready || selectingModel) return;

    if (!ref) {
      const updatedSettings = { ...settings, model: "" };
      updateSettings(updatedSettings);
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
      updateSettings(updatedSettings);
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

  const handleSelectSession = async (sessionItem: SessionHistoryEntry) => {
    try {
      const workspaceSettings = sessionItem.cwd && sessionItem.cwd !== settings.cwd
        ? { ...settings, cwd: sessionItem.cwd }
        : settings;
      const nextSettings = workspaceSettings.noSession
        ? { ...workspaceSettings, noSession: false }
        : workspaceSettings;
      setActiveSessionId(sessionItem.id);
      saveActiveSession({ id: sessionItem.id, filePath: sessionItem.file_path, cwd: nextSettings.cwd });
      if (nextSettings !== settings) {
        updateSettings(nextSettings);
        saveSettings(nextSettings);
      }
      if (workspaceSettings.noSession) {
        appendSystem("[session] 已关闭 no-session，继续聊天的内容会保存到左侧历史记录。");
      }
      await doStart(nextSettings, sessionItem.file_path);
      await loadSessionTranscript(sessionItem.id, sessionItem.file_path);
    } catch (err) {
      appendSystem(`[load history failed] ${String(err)}`);
    }
  };

  const handleNewSession = () => {
    const nextSettings = settings.noSession
      ? { ...settings, noSession: false }
      : settings;
    if (nextSettings !== settings) {
      updateSettings(nextSettings);
      saveSettings(nextSettings);
      appendSystem("[session] 已关闭 no-session，新会话会保存到左侧历史记录。");
    }
    clearActiveSession();
    setActiveSessionId("");
    void doStart(nextSettings);
  };

  const handleInsertFileReference = (filePath: string) => {
    const relativePath = filePath.startsWith(settings.cwd)
      ? filePath.slice(settings.cwd.length).replace(/^[/\\]/, "")
      : filePath;
    const addition = `@${relativePath} `;
    setComposerText((prev) => (prev ? `${prev} ${addition}` : addition));
    composerRef.current?.focus();
  };

  const handleInsertAgentSpawn = (text: string) => {
    // Agent click inserts a spawn instruction prefix; never auto-sends.
    // Keep an existing draft by appending below it instead of replacing.
    setComposerText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
    composerRef.current?.focus();
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

    // Optimistically show user bubble on the right immediately!
    appendUser(text);
    bumpMessageCount();

    const isSlash = text.trimStart().startsWith("/");
    if (isSlash) {
      void promptOrAbortAndPrompt(text, status.is_streaming).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    if (workMode === "chat") {
      void promptOrAbortAndPrompt(text, status.is_streaming).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    if (workMode === "plan") {
      const payload = PLAN_PREFIX + text;
      void sendPrompt(payload).catch((err) =>
        appendSystem(`[send failed] ${String(err)}`)
      );
      return;
    }

    if (!lastPlanText.trim()) {
      void promptOrAbortAndPrompt(text, status.is_streaming).catch((err) =>
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
          onInsertFileReference={handleInsertFileReference}
        />

        <SessionsPane
          status={status}
          cwd={settings.cwd}
          activeSessionId={activeSessionId}
          workspaceGroups={workspaceGroups}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onRefreshWorkspaces={loadWorkspaces}
          onOpenSettings={() => setSettingsOpen(true)}
          onAddWorkspace={handleAddWorkspace}
          onInsertAgentSpawn={handleInsertAgentSpawn}
          onInsertAgentSlash={handleInsertSlash}
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
          currentCwd={settings.cwd}
          workspaceGroups={workspaceGroups}
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
          onSelectWorkspace={handleSelectWorkspace}
          onAddWorkspace={handleAddWorkspace}
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
          onNewSession={handleNewSession}
          onAbort={() => void abort()}
        />
      </div>
      <div id="status-bar" title={fullTipStatus.join(" · ")}>
        {visibleStatus.join(" · ")}
      </div>

      <PermissionDialog
        request={activeUiRequest}
        onRespond={async (reqId, resp) => {
          setActiveUiRequest(null);
          try {
            await respondExtensionUi(reqId, resp);
          } catch (err) {
            console.error("Failed to respond to permission request:", err);
          }
        }}
      />
    </div>
  );
}
