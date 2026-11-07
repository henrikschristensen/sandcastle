import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  claudeHostSessionPath,
  claudeSandboxSessionPath,
  claudeSubagentsDirOnHost,
  copilotHostSessionsDir,
  copilotSessionPath,
  cursorChatDirName,
  cursorHostChatsDir,
  encodePiSessionDir,
  findClaudeSessionOnHost,
  findCodexSessionOnHost,
  findPiSessionOnHost,
  findVibeSessionOnHost,
  homeDir,
  isRecord,
  listClaudeSubagentSessionsInSandbox,
  listFilesRecursive,
  locateSandboxSessionFile,
  makeSessionFileStorage,
  opencodeHostDatabase,
  opencodeHostSessionsDir,
  pathExists,
  piSessionDirPath,
  requireHostSessionPath,
  sandboxDirsOf,
  transferClaudeSession,
  transferCodexSession,
  transferCopilotSession,
  transferPiSession,
  transferVibeMetaJson,
  vibeHostSessionsDir,
  vibeSandboxSessionsDir,
} from "./SessionStore.js";
import type { HostSessionLookup } from "./SessionStore.js";
import type { BindMountSandboxHandle } from "./SandboxProvider.js";
import type { ContextWindow } from "./ContextWindow.js";
import { ForkNotSupportedError } from "./errors.js";

export type ParsedStreamEvent =
  | { type: "text"; text: string }
  /**
   * The input side of ONE model call (cache included), emitted once per call.
   * The Orchestrator keeps the last one per iteration; see ContextWindow.
   */
  | { type: "context_window"; contextWindow: ContextWindow }
  | { type: "result"; result: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "session_id"; sessionId: string }
  | { type: "usage"; usage: IterationUsage }
  /**
   * The agent reported a failure in its own stream (an API rejection, a
   * failed turn). Some agents exit 0 after one, so the Orchestrator fails the
   * run on it whatever the exit code.
   */
  | { type: "error"; message: string };

/** @internal Single-quote a string for safe use in a POSIX shell command. */
export const shellEscape = (s: string): string =>
  `'${s.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Build a `context_window` event from ONE model call's input-side buckets
 * (uncached input plus each cache bucket the agent reports separately).
 * Returns nothing when the input is missing or the call reports zero tokens,
 * so a malformed or failed call cannot replace a real figure.
 */
const contextWindowEvent = (
  input: unknown,
  ...cacheBuckets: unknown[]
): ParsedStreamEvent[] => {
  if (typeof input !== "number") return [];
  let tokens = input;
  for (const n of cacheBuckets) if (typeof n === "number") tokens += n;
  return tokens > 0
    ? [{ type: "context_window", contextWindow: { tokens } }]
    : [];
};

/**
 * Claude Code: each `assistant` line carries its API call's `message.usage`
 * (lines split from one call repeat it), so the last one is the last call.
 * Subagent lines (`parent_tool_use_id` set) belong to another context and are
 * skipped. The `result` line's usage is summed over every call of the turn
 * and is deliberately never used.
 */
const parseClaudeContextWindow = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);
    if (obj.type !== "assistant" || obj.parent_tool_use_id) return [];
    const u = obj.message?.usage;
    return contextWindowEvent(
      u?.input_tokens,
      u?.cache_creation_input_tokens,
      u?.cache_read_input_tokens,
    );
  } catch {
    return [];
  }
};

/** Maps allowlisted tool names to the input field containing the display arg */
const TOOL_ARG_FIELDS: Record<string, string> = {
  Bash: "command",
  WebSearch: "query",
  WebFetch: "url",
  Agent: "description",
  Skill: "skill",
};

/** `value.message` when `value` is an object whose `message` is a string. */
const messageField = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string"
    ? value.message
    : undefined;

/**
 * Extract an error message from a parsed JSON error event.
 * Handles { error: "string" }, { error: { message: "string" } },
 * { error: { data: { message: "string" } } }, and { message: "string" }.
 */
const extractErrorMessage = (obj: unknown): string | undefined => {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  const err = "error" in obj ? obj.error : undefined;
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "object" && err !== null) {
    const nested =
      messageField(err) ?? ("data" in err ? messageField(err.data) : undefined);
    if (nested !== undefined) {
      return nested;
    }
  }
  return messageField(obj);
};

/** A content block of a Claude `assistant` stream-json event. */
interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** The tool_call event for an allowlisted tool_use block, if it is one. */
const toolCallFromClaudeBlock = (
  block: ClaudeContentBlock,
): ParsedStreamEvent | undefined => {
  if (
    block.type !== "tool_use" ||
    typeof block.name !== "string" ||
    block.input === undefined
  ) {
    return undefined;
  }
  const argField = TOOL_ARG_FIELDS[block.name];
  if (argField === undefined) {
    return undefined; // not allowlisted
  }
  const argValue = block.input[argField];
  if (typeof argValue !== "string") {
    return undefined; // missing/wrong arg field
  }
  return { type: "tool_call", name: block.name, args: argValue };
};

/** Joins each run of consecutive text events into one text event. */
const mergeAdjacentText = (
  events: readonly ParsedStreamEvent[],
): ParsedStreamEvent[] => {
  const merged: ParsedStreamEvent[] = [];
  for (const event of events) {
    const last = merged.at(-1);
    if (event.type === "text" && last?.type === "text") {
      merged[merged.length - 1] = {
        type: "text",
        text: last.text + event.text,
      };
    } else {
      merged.push(event);
    }
  }
  return merged;
};

/**
 * Turns a Claude assistant message's content blocks into events, in order:
 * consecutive text blocks are joined into one text event, and allowlisted
 * tool_use blocks become tool_call events. Other blocks are dropped.
 */
const parseClaudeAssistantContent = (
  content: readonly ClaudeContentBlock[],
): ParsedStreamEvent[] =>
  mergeAdjacentText(
    content.flatMap((block): ParsedStreamEvent[] => {
      if (block.type === "text" && typeof block.text === "string") {
        return [{ type: "text", text: block.text }];
      }
      const toolCall = toolCallFromClaudeBlock(block);
      return toolCall === undefined ? [] : [toolCall];
    }),
  );

const parseStreamJsonLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      return parseClaudeAssistantContent(
        obj.message.content as ClaudeContentBlock[],
      );
    }
    if (obj.type === "result" && typeof obj.result === "string") {
      if (obj.is_error === true) {
        return [{ type: "error", message: obj.result }];
      }
      return [{ type: "result", result: obj.result }];
    }
    if (
      obj.type === "system" &&
      obj.subtype === "init" &&
      typeof obj.session_id === "string"
    ) {
      return [{ type: "session_id", sessionId: obj.session_id }];
    }
  } catch {
    // Not valid JSON — skip
  }
  return [];
};

/**
 * Cursor Agent CLI print mode passes the prompt as a positional argv argument; stdin is not
 * documented for delivering the prompt. Linux enforces a per-argument limit (~128 KiB, ARG_MAX
 * stack). Stay slightly under so users get a clear error instead of spawn E2BIG.
 */
const CURSOR_PRINT_PROMPT_MAX_BYTES = 120 * 1024;

const assertCursorPrintPromptFitsArgv = (prompt: string): void => {
  const n = Buffer.byteLength(prompt, "utf8");
  if (n > CURSOR_PRINT_PROMPT_MAX_BYTES) {
    throw new Error(
      `Cursor print-mode prompt is ${n} bytes (max ${CURSOR_PRINT_PROMPT_MAX_BYTES} bytes). The Cursor CLI accepts the prompt only as a command-line argument; shorten the prompt or split the work. Other Sandcastle providers use stdin for large prompts.`,
    );
  }
};

/** Reads `<kind>ToolCall.args[field]` when it is a string. */
const cursorToolCallArg = (
  toolCall: unknown,
  field: string,
): string | undefined => {
  if (typeof toolCall !== "object" || toolCall === null) {
    return undefined;
  }
  const args: unknown = Reflect.get(toolCall, "args");
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(args, field);
  return typeof value === "string" ? value : undefined;
};

/**
 * Cursor's typed tool calls: `<kind>ToolCall` → display name and the arg it
 * shows. Newer Cursor CLIs (verified 2026-10-31, composer-2) run shell
 * commands as `shellToolCall` and write files as `editToolCall`.
 */
const CURSOR_TYPED_TOOL_CALLS: readonly {
  readonly kind: string;
  readonly name: string;
  readonly field: string;
}[] = [
  { kind: "readToolCall", name: "Read", field: "path" },
  { kind: "writeToolCall", name: "Write", field: "path" },
  { kind: "editToolCall", name: "Edit", field: "path" },
  { kind: "shellToolCall", name: "Bash", field: "command" },
];

/** Cursor's older `function` tool call: `{ name, arguments: "<json>" }`. */
const parseCursorFunctionToolCall = (fn: unknown): ParsedStreamEvent[] => {
  if (typeof fn !== "object" || fn === null) {
    return [];
  }
  const name: unknown = Reflect.get(fn, "name");
  if (typeof name !== "string") {
    return [];
  }
  const rawArguments: unknown = Reflect.get(fn, "arguments");
  const rawArgs = typeof rawArguments === "string" ? rawArguments : "";
  if (rawArgs === "") {
    return [{ type: "tool_call", name, args: "" }];
  }
  try {
    const parsedArgs = JSON.parse(rawArgs) as unknown;
    const command: unknown =
      typeof parsedArgs === "object" && parsedArgs !== null
        ? Reflect.get(parsedArgs, "command")
        : undefined;
    if (typeof command === "string") {
      return [{ type: "tool_call", name: "Bash", args: command }];
    }
  } catch {
    // Use raw arguments string for display.
  }
  return [{ type: "tool_call", name, args: rawArgs }];
};

/** Cursor stream-json emits top-level `tool_call` events (see Cursor CLI output-format docs). */
const parseCursorToolCallStarted = (
  obj: Record<string, unknown>,
): ParsedStreamEvent[] => {
  if (obj.type !== "tool_call" || obj.subtype !== "started") {
    return [];
  }
  const toolCall = obj.tool_call;
  if (typeof toolCall !== "object" || toolCall === null) {
    return [];
  }
  for (const { kind, name, field } of CURSOR_TYPED_TOOL_CALLS) {
    const args = cursorToolCallArg(Reflect.get(toolCall, kind), field);
    if (args !== undefined) {
      return [{ type: "tool_call", name, args }];
    }
  }
  return parseCursorFunctionToolCall(Reflect.get(toolCall, "function"));
};

/**
 * Cursor emits no `context_window` events on purpose. Its only token figures
 * are on the `result` line, summed over every model call of the turn (verified
 * 2026-10-31: `cacheReadTokens` grew ~5.5x with five calls over the same
 * content). With no per-call figure, no line beats a wrong one.
 */
const parseCursorStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not valid JSON — skip
    return [];
  }
  if (obj.type === "tool_call") {
    return parseCursorToolCallStarted(obj);
  }
  return parseStreamJsonLine(line);
};

/** Options passed to buildPrintCommand and buildInteractiveArgs. */
export interface AgentCommandOptions {
  readonly prompt: string;
  readonly dangerouslySkipPermissions: boolean;
  /** When set, the agent should resume the given session ID instead of starting fresh. */
  readonly resumeSession?: string;
  /**
   * When true alongside `resumeSession`, the agent should fork the session
   * instead of mutating it — Claude's `--fork-session`, pi's `--fork`, Codex's
   * `codex exec fork`. The parent session JSONL is left intact and the agent
   * writes a new session under a fresh id.
   */
  readonly forkSession?: boolean;
}

/** Return type of buildPrintCommand — command string plus optional stdin content.
 *  When `stdin` is set, the sandbox pipes it to the child process's stdin
 *  instead of inlining the prompt in argv, avoiding the Linux 128 KB per-arg limit. */
export interface PrintCommand {
  readonly command: string;
  readonly stdin?: string;
}

/** Per-iteration token usage snapshot extracted from the agent session. */
export interface IterationUsage {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly outputTokens: number;
}

export interface AgentSessionStorage {
  /** Transfer a session JSONL from the sandbox into the host store. */
  captureToHost(args: {
    hostCwd: string;
    sandboxCwd: string;
    sessionId: string;
    handle: BindMountSandboxHandle;
  }): Promise<void>;
  /** Transfer a session JSONL from the host store into the sandbox. */
  resumeIntoSandbox(args: {
    hostCwd: string;
    sandboxCwd: string;
    sessionId: string;
    handle: BindMountSandboxHandle;
  }): Promise<void>;
  /** Read a captured session JSONL from the host store. Returns undefined when absent. */
  readHostSession(cwd: string, sessionId: string): Promise<string | undefined>;
  /** Whether a session with the given id exists in the host store keyed on cwd. */
  existsOnHost(cwd: string, sessionId: string): Promise<boolean>;
  /** Absolute host path where a session would be stored (for not-found error messages). */
  hostSessionFilePath(cwd: string, sessionId: string): string | undefined;
  /**
   * Locate a session on the host by its unique id, independent of cwd encoding.
   * Used by the no-sandbox resume precheck, where the agent runs on the host and
   * writes the session in place under a cwd-derived directory Sandcastle cannot
   * reliably reconstruct. Returns the located path (or `undefined`) plus the
   * directory that was searched (for not-found errors).
   */
  findByIdOnHost(sessionId: string): Promise<HostSessionLookup>;
  /**
   * `false` when the agent's CLI can resume a session but has no native fork:
   * `.fork()` then throws `ForkNotSupportedError` before any sandbox starts.
   * Omitted means the agent forks.
   */
  readonly canFork?: boolean;
}

export interface AgentProvider {
  readonly name: string;
  /** Environment variables injected by this agent provider. Merged at launch time with env resolver and sandbox provider env. */
  readonly env: Record<string, string>;
  /** When true, session capture is enabled for this provider. Default: true for Claude Code, false for others. */
  readonly captureSessions: boolean;
  /** Provider-owned storage and transfer behavior for resumable agent sessions. */
  readonly sessionStorage?: AgentSessionStorage;
  buildPrintCommand(options: AgentCommandOptions): PrintCommand;
  buildInteractiveArgs?(options: AgentCommandOptions): string[];
  parseStreamLine(line: string): ParsedStreamEvent[];
  /** Parse token usage from the captured session JSONL content. Only implemented by Claude Code. */
  parseSessionUsage?(content: string): IterationUsage | undefined;
  /**
   * Parse the last model call's context window from the captured session
   * JSONL. For agents whose stream has no per-call figure (codex). Overrides
   * the stream's `context_window` events when it returns a value.
   */
  parseSessionContextWindow?(content: string): ContextWindow | undefined;
}

export const DEFAULT_MODEL = "claude-opus-4-8";

// ---------------------------------------------------------------------------
// Session storage helpers — file I/O lives here so callers (Orchestrator,
// resumePrecheck) work against the high-level AgentSessionStorage interface
// and tests can exercise transferClaudeSession / transferCodexSession as
// pure string functions.
// ---------------------------------------------------------------------------

const readSandboxFile = async (
  handle: Pick<BindMountSandboxHandle, "copyFileOut">,
  sandboxPath: string,
  tag: string,
): Promise<string> => {
  const tmpPath = join(
    tmpdir(),
    `sandcastle-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  await handle.copyFileOut(sandboxPath, tmpPath);
  try {
    return await readFile(tmpPath, "utf8");
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
};

/** A file to write into the sandbox; `tag` names its host temp file. */
interface SandboxFileWrite {
  readonly sandboxPath: string;
  readonly content: string;
  readonly tag: string;
}

const writeSandboxFile = async (
  handle: Pick<BindMountSandboxHandle, "copyFileIn" | "exec">,
  { sandboxPath, content, tag }: SandboxFileWrite,
): Promise<void> => {
  const tmpPath = join(
    tmpdir(),
    `sandcastle-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  await writeFile(tmpPath, content);
  try {
    await handle.exec(`mkdir -p ${JSON.stringify(posix.dirname(sandboxPath))}`);
    await handle.copyFileIn(tmpPath, sandboxPath);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
};

/**
 * Read a Claude JSONL out of the sandbox, rewrite its `cwd` fields from
 * `fromCwd` → `toCwd`, and write the result to `destPath` on the host. Used
 * by `captureToHost` for both the main session file and each subagent /
 * workflow transcript — the read→rewrite→ensure-dir→write sequence is
 * identical, only the source/dest paths differ.
 */
const copyClaudeSessionFile = async ({
  handle,
  sourcePath,
  fromCwd,
  toCwd,
  destPath,
  tag,
}: {
  handle: Pick<BindMountSandboxHandle, "copyFileOut">;
  sourcePath: string;
  fromCwd: string;
  toCwd: string;
  destPath: string;
  tag: string;
}): Promise<void> => {
  const jsonl = await readSandboxFile(handle, sourcePath, tag);
  const rewritten = transferClaudeSession(jsonl, fromCwd, toCwd);
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, rewritten);
};

/** A Claude session to copy out of the sandbox, and where it goes. */
interface ClaudeSessionCapture {
  handle: BindMountSandboxHandle;
  hostCwd: string;
  sandboxCwd: string;
  sessionId: string;
  sandboxProjectsDir: string;
  hostProjectsDir: string | undefined;
}

/**
 * Subagent / workflow transcripts: best-effort. A missing `subagents/`
 * dir is the normal case (no Agent-tool / Workflow usage this run);
 * an individual subagent failing to copy must not abort siblings or
 * the (already-successful) main capture.
 */
const captureClaudeSubagents = async ({
  handle,
  hostCwd,
  sandboxCwd,
  sessionId,
  sandboxProjectsDir,
  hostProjectsDir,
}: ClaudeSessionCapture): Promise<void> => {
  const subagentSandboxPaths = await listClaudeSubagentSessionsInSandbox(
    sandboxCwd,
    sessionId,
    handle,
    sandboxProjectsDir,
  );
  const hostSubagentsDir = claudeSubagentsDirOnHost(
    hostCwd,
    sessionId,
    hostProjectsDir,
  );
  for (const sandboxSubagentPath of subagentSandboxPaths) {
    try {
      await copyClaudeSessionFile({
        handle,
        sourcePath: sandboxSubagentPath,
        fromCwd: sandboxCwd,
        toCwd: hostCwd,
        destPath: join(hostSubagentsDir, posix.basename(sandboxSubagentPath)),
        tag: "claude-sub",
      });
    } catch (error) {
      console.error(
        `sandcastle: failed to capture Claude subagent transcript ${sandboxSubagentPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};

/** What `resumeIntoSandbox` is given. */
type SessionTransfer = Parameters<AgentSessionStorage["resumeIntoSandbox"]>[0];

/** Where an agent keeps its sessions, on the host and in the sandbox. */
interface SessionDirs {
  readonly hostSessionsDir: string | undefined;
  readonly sandboxSessionsDir: string;
}

const resumeClaudeIntoSandbox = async (
  { hostCwd, sandboxCwd, sessionId, handle }: SessionTransfer,
  dirs: {
    readonly hostProjectsDir: string | undefined;
    readonly sandboxProjectsDir: string;
  },
): Promise<void> => {
  const hostPath = claudeHostSessionPath(
    hostCwd,
    sessionId,
    dirs.hostProjectsDir,
  );
  const jsonl = await readFile(hostPath, "utf8");
  await writeSandboxFile(handle, {
    sandboxPath: claudeSandboxSessionPath(
      sandboxCwd,
      sessionId,
      dirs.sandboxProjectsDir,
    ),
    content: transferClaudeSession(jsonl, hostCwd, sandboxCwd),
    tag: "claude-res",
  });
};

/**
 * Copies a Claude session out of the sandbox: the main session file, then
 * its subagent / workflow transcripts.
 */
const captureClaudeSession = (capture: ClaudeSessionCapture): Promise<void> =>
  // Main session: failure is fatal — the user expects their session.
  copyClaudeSessionFile({
    handle: capture.handle,
    sourcePath: claudeSandboxSessionPath(
      capture.sandboxCwd,
      capture.sessionId,
      capture.sandboxProjectsDir,
    ),
    fromCwd: capture.sandboxCwd,
    toCwd: capture.hostCwd,
    destPath: claudeHostSessionPath(
      capture.hostCwd,
      capture.sessionId,
      capture.hostProjectsDir,
    ),
    tag: "claude-cap",
  }).then(() => captureClaudeSubagents(capture));

const makeClaudeSessionStorage = (
  options?: ClaudeCodeOptions,
): AgentSessionStorage => {
  const hostProjectsDir = options?.sessionStorage?.hostProjectsDir;
  const sandboxProjectsDirOf = (handle: BindMountSandboxHandle): string =>
    options?.sessionStorage?.sandboxProjectsDir ??
    posix.join(sandboxDirsOf(handle).home, ".claude", "projects");

  return {
    hostSessionFilePath: (cwd, id) =>
      claudeHostSessionPath(cwd, id, hostProjectsDir),
    existsOnHost: (cwd, id) =>
      pathExists(claudeHostSessionPath(cwd, id, hostProjectsDir)),
    readHostSession: async (cwd, id) => {
      const path = claudeHostSessionPath(cwd, id, hostProjectsDir);
      if (!(await pathExists(path))) return undefined;
      return readFile(path, "utf8");
    },
    captureToHost: ({ hostCwd, sandboxCwd, sessionId, handle }) =>
      captureClaudeSession({
        handle,
        hostCwd,
        sandboxCwd,
        sessionId,
        sandboxProjectsDir: sandboxProjectsDirOf(handle),
        hostProjectsDir,
      }),
    resumeIntoSandbox: (transfer) =>
      resumeClaudeIntoSandbox(transfer, {
        hostProjectsDir,
        sandboxProjectsDir: sandboxProjectsDirOf(transfer.handle),
      }),
    findByIdOnHost: (id) => findClaudeSessionOnHost(id, hostProjectsDir),
  };
};

const resumeCodexIntoSandbox = async (
  { hostCwd, sandboxCwd, sessionId, handle }: SessionTransfer,
  dirs: SessionDirs,
): Promise<void> => {
  const found = await findCodexSessionOnHost(sessionId, dirs.hostSessionsDir);
  const path = requireHostSessionPath(found, sessionId);
  const jsonl = await readFile(path, "utf8");
  await writeSandboxFile(handle, {
    sandboxPath: posix.join(
      dirs.sandboxSessionsDir,
      ...relative(found.searchedRoot, path).split(/[\\/]/u),
    ),
    content: transferCodexSession(jsonl, hostCwd, sandboxCwd),
    tag: "codex-res",
  });
};

/**
 * Codex sessions live at YYYY/MM/DD/rollout-*-<id>.jsonl — the path is not
 * derivable from (cwd, id) alone, so we cache the path written by
 * captureToHost for hostSessionFilePath to surface on the IterationResult.
 */
const makeCodexSessionStorage = (
  options?: CodexOptions,
): AgentSessionStorage => {
  const hostSessionsDir = options?.sessionStorage?.hostSessionsDir;
  const sandboxSessionsDirOf = (handle: BindMountSandboxHandle): string =>
    options?.sessionStorage?.sandboxSessionsDir ??
    posix.join(sandboxDirsOf(handle).home, ".codex", "sessions");
  const capturedPaths = new Map<string, string>();

  return {
    hostSessionFilePath: (_cwd, id) => capturedPaths.get(id),
    existsOnHost: async (_cwd, id) => {
      const found = await findCodexSessionOnHost(id, hostSessionsDir);
      return found.path !== undefined;
    },
    readHostSession: async (_cwd, id) => {
      const found = await findCodexSessionOnHost(id, hostSessionsDir);
      if (!found.path) return undefined;
      return readFile(found.path, "utf8");
    },
    captureToHost: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const located = await locateSandboxSessionFile(
        handle,
        sandboxSessionsDirOf(handle),
        `rollout-*-${sessionId}.jsonl`,
      );
      const jsonl = await readSandboxFile(handle, located.path, "codex-cap");
      const rewritten = transferCodexSession(jsonl, sandboxCwd, hostCwd);
      const root = hostSessionsDir ?? join(homeDir(), ".codex", "sessions");
      const target = join(root, located.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, rewritten);
      capturedPaths.set(sessionId, target);
    },
    resumeIntoSandbox: (transfer) =>
      resumeCodexIntoSandbox(transfer, {
        hostSessionsDir,
        sandboxSessionsDir: sandboxSessionsDirOf(transfer.handle),
      }),
    findByIdOnHost: (id) => findCodexSessionOnHost(id, hostSessionsDir),
  };
};

// ---------------------------------------------------------------------------
// Pi agent provider
// ---------------------------------------------------------------------------

/**
 * Where a captured pi session lands on the host. Pi resolves `--session <id>`
 * against the *current project's* encoded directory first; a transferred file
 * in any other directory hits the "fork session?" prompt, which hangs in
 * print/json mode. So we land the file in `--<enc-host-cwd>--/<filename>`, not
 * the sandbox's encoded dir.
 */
const piHostCaptureTarget = (
  hostCwd: string,
  sandboxPath: string,
  hostSessionsDir: string | undefined,
): string =>
  join(piSessionDirPath(hostCwd, hostSessionsDir), posix.basename(sandboxPath));

const resumePiIntoSandbox = async (
  { hostCwd, sandboxCwd, sessionId, handle }: SessionTransfer,
  dirs: SessionDirs,
): Promise<void> => {
  const found = await findPiSessionOnHost(sessionId, dirs.hostSessionsDir);
  const path = requireHostSessionPath(found, sessionId);
  const jsonl = await readFile(path, "utf8");
  const filename = posix.basename(path.replaceAll("\\", "/"));
  await writeSandboxFile(handle, {
    sandboxPath: posix.join(
      dirs.sandboxSessionsDir,
      encodePiSessionDir(sandboxCwd),
      filename,
    ),
    content: transferPiSession(jsonl, hostCwd, sandboxCwd),
    tag: "pi-res",
  });
};

// Pi names its JSONL `<timestamp>_<id>.jsonl`, so the file is not derivable
// from (cwd, id). captureToHost remembers what it wrote, so the iteration's
// sessionFilePath is the JSONL itself. Before capture (the resume precheck's
// not-found message) the best we can name is the directory.
const makePiSessionStorage = (options?: PiOptions): AgentSessionStorage => {
  const hostSessionsDir = options?.sessionStorage?.hostSessionsDir;
  const sandboxSessionsDirOf = (handle: BindMountSandboxHandle): string =>
    options?.sessionStorage?.sandboxSessionsDir ??
    posix.join(sandboxDirsOf(handle).home, ".pi", "agent", "sessions");
  const capturedPaths = new Map<string, string>();
  return {
    hostSessionFilePath: (cwd, id) =>
      capturedPaths.get(id) ?? piSessionDirPath(cwd, hostSessionsDir),
    existsOnHost: async (_cwd, id) => {
      const found = await findPiSessionOnHost(id, hostSessionsDir);
      return found.path !== undefined;
    },
    readHostSession: async (_cwd, id) => {
      const { path } = await findPiSessionOnHost(id, hostSessionsDir);
      return path === undefined ? undefined : readFile(path, "utf8");
    },
    captureToHost: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const located = await locateSandboxSessionFile(
        handle,
        sandboxSessionsDirOf(handle),
        `*_${sessionId}.jsonl`,
      );
      const jsonl = await readSandboxFile(handle, located.path, "pi-cap");
      const rewritten = transferPiSession(jsonl, sandboxCwd, hostCwd);
      const target = piHostCaptureTarget(
        hostCwd,
        located.path,
        hostSessionsDir,
      );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, rewritten);
      capturedPaths.set(sessionId, target);
    },
    resumeIntoSandbox: (transfer) =>
      resumePiIntoSandbox(transfer, {
        hostSessionsDir,
        sandboxSessionsDir: sandboxSessionsDirOf(transfer.handle),
      }),
    findByIdOnHost: (id) => findPiSessionOnHost(id, hostSessionsDir),
  };
};

/** A message in pi's `agent_end` event. */
interface PiAgentEndMessage {
  role: string;
  content: { type: string; text?: string }[];
  stopReason?: string;
  errorMessage?: string;
}

/** The last assistant message, or null if there is none. */
const lastAssistantMessage = (
  messages: readonly (PiAgentEndMessage | null)[],
): PiAgentEndMessage | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      return msg;
    }
  }
  return null;
};

/**
 * Reads pi's final answer from its `agent_end` messages: the last assistant
 * message's text as a result, or an error if that message stopped on error.
 */
const parsePiAgentEnd = (
  messages: readonly (PiAgentEndMessage | null)[],
): ParsedStreamEvent[] => {
  const msg = lastAssistantMessage(messages);
  if (msg === null) {
    return [];
  }
  // When the model call fails (e.g. an API 400), pi puts the error on
  // the last assistant message and still exits 0.
  if (msg.stopReason === "error") {
    return [
      {
        type: "error",
        message:
          typeof msg.errorMessage === "string" && msg.errorMessage
            ? msg.errorMessage
            : 'pi stopped with stopReason "error"',
      },
    ];
  }
  const texts = msg.content.flatMap((block) =>
    block.type === "text" && typeof block.text === "string" ? [block.text] : [],
  );
  return texts.length > 0 ? [{ type: "result", result: texts.join("") }] : [];
};

/**
 * Map one pi message's `usage` (`input`, `output`, `cacheRead` and
 * `cacheWrite` are separate buckets) to IterationUsage.
 */
const parsePiUsage = (u: unknown): IterationUsage | undefined => {
  if (typeof u !== "object" || u === null) {
    return undefined;
  }
  const field = (key: string): unknown => Reflect.get(u, key);
  const input = field("input");
  const output = field("output");
  const cacheRead = field("cacheRead");
  const cacheWrite = field("cacheWrite");
  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    typeof cacheRead !== "number" ||
    typeof cacheWrite !== "number"
  ) {
    return undefined;
  }
  return {
    inputTokens: input,
    cacheCreationInputTokens: cacheWrite,
    cacheReadInputTokens: cacheRead,
    outputTokens: output,
  };
};

const parsePiStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);
    // The first line of pi's --mode json stdout stream is a `session` header
    // carrying the UUID; subsequent stream entries (model_change,
    // thinking_level_change, message, ...) do not. Verified against
    // @mariozechner/pi-coding-agent 0.73.1 and @earendil-works/pi-coding-agent 1.5.0.
    if (obj.type === "session" && typeof obj.id === "string") {
      return [{ type: "session_id", sessionId: obj.id }];
    }
    // Each assistant message_end is one model call with its own usage. Not
    // agent_end, whose messages[] repeat every call's usage. The Orchestrator
    // keeps the last event of each kind, so both report the last call.
    if (obj.type === "message_end" && obj.message?.role === "assistant") {
      const u = obj.message.usage;
      const usage = parsePiUsage(u);
      return [
        ...contextWindowEvent(u?.input, u?.cacheRead, u?.cacheWrite),
        ...(usage ? [{ type: "usage" as const, usage }] : []),
      ];
    }
    if (obj.type === "message_update" && obj.assistantMessageEvent) {
      const evt = obj.assistantMessageEvent as {
        type: string;
        delta?: string;
      };
      if (evt.type === "text_delta" && typeof evt.delta === "string") {
        return [{ type: "text", text: evt.delta }];
      }
      return [];
    }
    if (obj.type === "tool_execution_start") {
      const rawName = obj.toolName;
      if (typeof rawName !== "string") return [];
      // Pi's built-in tools are lowercase (`bash`); match the shared allowlist
      // case-insensitively and display its canonical name (`Bash`).
      const toolName = Object.keys(TOOL_ARG_FIELDS).find(
        (name) => name.toLowerCase() === rawName.toLowerCase(),
      );
      if (toolName === undefined) return [];
      const argField = TOOL_ARG_FIELDS[toolName];
      if (argField === undefined) return [];
      const args = obj.args as Record<string, unknown> | undefined;
      if (!args) return [];
      const argValue = args[argField];
      if (typeof argValue !== "string") return [];
      return [{ type: "tool_call", name: toolName, args: argValue }];
    }
    // Pi emits agent_error / error events on stdout (not stderr) for auth
    // failures, rate limits, and API errors.
    if (obj.type === "agent_error" || obj.type === "error") {
      const msg = extractErrorMessage(obj);
      return msg ? [{ type: "error", message: msg }] : [];
    }
    if (obj.type === "agent_end" && Array.isArray(obj.messages)) {
      return parsePiAgentEnd(obj.messages as (PiAgentEndMessage | null)[]);
    }
  } catch {
    // Not valid JSON — skip
  }
  return [];
};

/** Options for the pi agent provider. */
export interface PiOptions {
  /**
   * Reasoning effort level. Maps to the CLI's --thinking flag. When omitted,
   * no flag is passed and pi uses its own default (`medium`), which some
   * models reject: with pi 0.73.1, `anthropic/claude-haiku-5-5` returns a 400.
   * Pass `"off"` for those.
   */
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override pi session directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostSessionsDir?: string;
    readonly sandboxSessionsDir?: string;
  };
}

export const pi = (
  model: string,
  options?: PiOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "pi",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makePiSessionStorage(options),

  buildPrintCommand({
    prompt,
    resumeSession,
    forkSession,
  }: AgentCommandOptions): PrintCommand {
    const thinkingFlag = options?.thinking
      ? ` --thinking ${options.thinking}`
      : "";
    // Pi persists print-mode sessions by default; `--session <id>` resolves an
    // existing session and appends to it in place. Drop the legacy
    // `--no-session` flag so fresh runs also persist and can be resumed later.
    // `--fork <id>` instead copies the session into a new file under a fresh
    // id (reported on the stream's `session` header line), leaving the parent
    // untouched. Pi rejects `--fork` combined with `--session`.
    const sessionFlag = resumeSession
      ? ` --${forkSession ? "fork" : "session"} ${shellEscape(resumeSession)}`
      : "";
    return {
      command: `pi -p --mode json --model ${shellEscape(model)}${thinkingFlag}${sessionFlag}`,
      stdin: prompt,
    };
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["pi", "--model", model];
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parsePiStreamLine(line);
  },
});

// ---------------------------------------------------------------------------
// Codex agent provider
// ---------------------------------------------------------------------------

/**
 * Map a Codex `turn.completed` usage object to the Claude-shaped IterationUsage.
 *
 * OpenAI/Codex usage is `{ input_tokens, cached_input_tokens, output_tokens }`,
 * where `input_tokens` is the *total* prompt tokens and `cached_input_tokens` is
 * a subset already included in that total. There is no cache-creation concept.
 * To avoid double-counting cached tokens in the context-window display (which
 * sums input + cacheCreation + cacheRead), the cached portion maps to
 * `cacheReadInputTokens` and the remainder to `inputTokens`.
 */
const parseCodexUsage = (usage: unknown): IterationUsage | undefined => {
  if (typeof usage !== "object" || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  if (
    typeof u.input_tokens !== "number" ||
    typeof u.cached_input_tokens !== "number" ||
    typeof u.output_tokens !== "number"
  ) {
    return undefined;
  }
  return {
    inputTokens: u.input_tokens - u.cached_input_tokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: u.cached_input_tokens,
    outputTokens: u.output_tokens,
  };
};

/**
 * Codex's `exec --json` stream has no per-request usage: `turn.completed`
 * sums every request of the session (#898). The rollout JSONL does: each
 * `token_count` event has `last_token_usage` (one request; its `input_tokens`
 * already includes cached and cache-write tokens) and the model's
 * `model_context_window`. The last one is the last request.
 */
const parseCodexSessionContextWindow = (
  content: string,
): ContextWindow | undefined => {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "event_msg" || obj.payload?.type !== "token_count") {
        continue;
      }
      const { info } = obj.payload;
      const tokens = info?.last_token_usage?.input_tokens;
      if (typeof tokens !== "number" || tokens <= 0) continue;
      const limit = info.model_context_window;
      return typeof limit === "number" && limit > 0
        ? { tokens, limit }
        : { tokens };
    } catch {
      // Not valid JSON — skip
    }
  }
  return undefined;
};

const parseCodexStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);

    if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
      return [{ type: "session_id", sessionId: obj.thread_id }];
    }

    // item.completed with agent_message → text + result
    if (
      obj.type === "item.completed" &&
      obj.item?.type === "agent_message" &&
      typeof obj.item.text === "string"
    ) {
      const { text } = obj.item;
      return [
        { type: "text", text },
        { type: "result", result: text },
      ];
    }

    // item.started with command_execution → tool call
    if (
      obj.type === "item.started" &&
      obj.item?.type === "command_execution" &&
      typeof obj.item.command === "string"
    ) {
      return [{ type: "tool_call", name: "Bash", args: obj.item.command }];
    }

    // Codex emits error events on stdout (not stderr) for auth failures,
    // rate limits, and API errors. Capture them as result events so the
    // Orchestrator's stderr-empty fallback can surface them to the user.
    if (obj.type === "error") {
      const msg = extractErrorMessage(obj);
      return msg ? [{ type: "result", result: msg }] : [];
    }

    // turn.failed is codex's terminal failure for the turn.
    if (obj.type === "turn.failed") {
      const msg = extractErrorMessage(obj);
      return [{ type: "error", message: msg ?? "codex turn failed" }];
    }

    // turn.completed carries token usage for the turn.
    if (obj.type === "turn.completed") {
      const usage = parseCodexUsage(obj.usage);
      return usage ? [{ type: "usage", usage }] : [];
    }
  } catch {
    // Not valid JSON — skip
  }
  return [];
};

/** Options for the codex agent provider. */
export interface CodexOptions {
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override Codex session directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostSessionsDir?: string;
    readonly sandboxSessionsDir?: string;
  };
  /**
   * Maps to Codex's `approvals_reviewer` config key (set via
   * `-c approvals_reviewer="<value>"`). When set to `"auto_review"`, the
   * provider swaps the default `--dangerously-bypass-approvals-and-sandbox`
   * for an interactive approval policy (`-a on-request`) and Codex's most
   * permissive sandbox (`-s danger-full-access`) — auto-review needs
   * something to review, and the safety boundary is the reviewer agent
   * rather than the filesystem sandbox.
   */
  readonly approvalsReviewer?: "user" | "auto_review";
}

/** The `codex exec` command for a print-mode run. */
const buildCodexPrintCommand = (
  model: string,
  options: CodexOptions | undefined,
  { prompt, resumeSession, forkSession }: AgentCommandOptions,
): PrintCommand => {
  const effortFlag = options?.effort
    ? ` -c ${shellEscape(`model_reasoning_effort="${options.effort}"`)}`
    : "";
  // auto_review only fires on interactive approvals, so the bypass flag is
  // dropped in favour of `-a on-request`. `-s danger-full-access` disables
  // Codex's own filesystem sandbox — Sandcastle owns that boundary, and
  // here the reviewer agent owns the per-action approval boundary.
  const approvalsFlags =
    options?.approvalsReviewer === "auto_review"
      ? ` -a on-request -s danger-full-access -c ${shellEscape(`approvals_reviewer="auto_review"`)}`
      : " --dangerously-bypass-approvals-and-sandbox";
  // Codex distinguishes fork from resume at the verb level — `codex exec
  // fork <id>` leaves the parent rollout intact; `codex exec resume <id>`
  // appends to it. See ADR 0018.
  let base: string;
  if (resumeSession && forkSession) {
    base = `codex exec fork ${shellEscape(resumeSession)}`;
  } else if (resumeSession) {
    base = `codex exec resume ${shellEscape(resumeSession)}`;
  } else {
    base = "codex exec";
  }
  const stdinArg = resumeSession ? " -" : "";
  return {
    command: `${base} --json${approvalsFlags} -m ${shellEscape(model)}${effortFlag}${stdinArg}`,
    stdin: prompt,
  };
};

export const codex = (
  model: string,
  options?: CodexOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "codex",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeCodexSessionStorage(options),

  buildPrintCommand(commandOptions: AgentCommandOptions): PrintCommand {
    return buildCodexPrintCommand(model, options, commandOptions);
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["codex", "--model", model];
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseCodexStreamLine(line);
  },

  parseSessionContextWindow(content: string): ContextWindow | undefined {
    return parseCodexSessionContextWindow(content);
  },
});

// ---------------------------------------------------------------------------
// Cursor agent provider
// ---------------------------------------------------------------------------

/** Options for the cursor agent provider. */
export interface CursorOptions {
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override Cursor `chats` directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostChatsDir?: string;
    readonly sandboxChatsDir?: string;
  };
}

/**
 * A Cursor chat is one SQLite `store.db` under the chat dir of the cwd it ran
 * in, so it moves as a single binary file, unrewritten. The CLI resumes
 * (`--resume <id>`) but has no fork flag, so the provider declares
 * `canFork: false` (ADR 0021).
 */
const makeCursorSessionStorage = (
  options?: CursorOptions,
): AgentSessionStorage => {
  const hostDir = options?.sessionStorage?.hostChatsDir ?? cursorHostChatsDir();
  const sandboxDirOverride = options?.sessionStorage?.sandboxChatsDir;
  return {
    ...makeSessionFileStorage({
      hostRoot: hostDir,
      hostPath: (cwd, id) =>
        join(hostDir, cursorChatDirName(cwd), id, "store.db"),
      hostPathsById: (id, chatDirs) =>
        chatDirs.map((chatDir) => join(hostDir, chatDir, id, "store.db")),
      sandboxPath: (cwd, id, dirs) =>
        posix.join(
          sandboxDirOverride ?? posix.join(dirs.home, ".cursor", "chats"),
          cursorChatDirName(cwd),
          id,
          "store.db",
        ),
    }),
    canFork: false,
  };
};

export const cursor = (
  model: string,
  options?: CursorOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "cursor",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeCursorSessionStorage(options),

  buildPrintCommand({
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
    forkSession,
  }: AgentCommandOptions): PrintCommand {
    if (resumeSession !== undefined && forkSession === true) {
      throw new ForkNotSupportedError({
        message:
          "cursor cannot fork a session: its CLI resumes but has no fork. Use resume() to continue the session in place.",
        agentProvider: "cursor",
      });
    }
    assertCursorPrintPromptFitsArgv(prompt);
    const forceFlag = dangerouslySkipPermissions ? " --force" : "";
    // `--resume` takes an optional value, so the id is bound with `=`.
    const resumeFlag =
      resumeSession === undefined
        ? ""
        : ` --resume=${shellEscape(resumeSession)}`;
    return {
      command: `agent --print --output-format stream-json --model ${shellEscape(model)} ${forceFlag}${resumeFlag} ${shellEscape(prompt)}`,
    };
  },

  buildInteractiveArgs({
    prompt,
    dangerouslySkipPermissions,
  }: AgentCommandOptions): string[] {
    const args = ["agent", "--model", model];
    if (dangerouslySkipPermissions) args.push("--force");
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseCursorStreamLine(line);
  },
});

// ---------------------------------------------------------------------------
// OpenCode agent provider
// ---------------------------------------------------------------------------

/** Maps OpenCode tool names to the input field containing the friendly display
 *  arg. Tools not listed here are still surfaced, falling back to a JSON dump of
 *  the whole input. The tool name is surfaced as-is (OpenCode's lowercase names). */
const OPENCODE_TOOL_ARG_FIELDS: Record<string, string> = {
  bash: "command",
  webfetch: "url",
  task: "description",
};

const parseOpenCodeStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);
    const { part } = obj;

    // step_start carries the session ID for the run.
    if (obj.type === "step_start" && typeof obj.sessionID === "string") {
      return [{ type: "session_id", sessionId: obj.sessionID }];
    }

    // step_finish is one model call; part.tokens is that call's usage.
    if (obj.type === "step_finish" && part?.tokens) {
      const t = part.tokens;
      return contextWindowEvent(t.input, t.cache?.read, t.cache?.write);
    }

    // text event → assistant text. Emit both text (for streaming display) and
    // result (final message; the last result wins in the Orchestrator).
    if (
      obj.type === "text" &&
      part?.type === "text" &&
      typeof part.text === "string"
    ) {
      return [
        { type: "text", text: part.text },
        { type: "result", result: part.text },
      ];
    }

    // tool_use event → tool call. Tool name is in part.tool, args in
    // part.state.input. Gate on the completed status so intermediate
    // pending/running states don't surface duplicate tool calls.
    if (obj.type === "tool_use" && part?.type === "tool") {
      if (typeof part.tool !== "string") return [];
      const state = part.state as
        | { status?: string; input?: Record<string, unknown> }
        | undefined;
      if (state?.status !== "completed") return [];
      const { input } = state;
      if (!input) return [];
      const argField = OPENCODE_TOOL_ARG_FIELDS[part.tool];
      const argValue = argField === undefined ? undefined : input[argField];
      const args =
        typeof argValue === "string" ? argValue : JSON.stringify(input);
      return [{ type: "tool_call", name: part.tool, args }];
    }

    // OpenCode emits error events on stdout (not stderr) for auth failures,
    // rate limits, and API errors, and still exits 0 (opencode 1.3.13).
    if (obj.type === "error") {
      const msg = extractErrorMessage(obj);
      return msg ? [{ type: "error", message: msg }] : [];
    }

    // tool output, etc. → skip
  } catch {
    // Not valid JSON — skip
  }
  return [];
};

/** Options for the opencode agent provider. */
export interface OpenCodeOptions {
  /** Provider-specific reasoning effort variant (e.g. "high", "max", "low", "minimal"). */
  readonly variant?: string;
  /**
   * Named OpenCode agent/mode to run, mapped to OpenCode's own `--agent` flag
   * (e.g. "build", "plan"). This is distinct from Sandcastle's `--agent`
   * provider selector — it chooses an agent *inside* OpenCode.
   */
  readonly agent?: string;
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override where session exports live, for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostSessionsDir?: string;
    readonly sandboxExportDir?: string;
  };
}

/**
 * OpenCode's sessions live in its SQLite database, so a session moves as the
 * JSON of `opencode export <id>`, its documented interchange format: exported
 * in the sandbox after a run, and `opencode import`ed from the sandbox repo
 * before a resume (ADR 0022). The import keeps the session id and re-homes the
 * session to the importing project, so no rewrite is needed.
 */
const makeOpenCodeSessionStorage = (
  options?: OpenCodeOptions,
): AgentSessionStorage => {
  const hostDir =
    options?.sessionStorage?.hostSessionsDir ?? opencodeHostSessionsDir();
  const exportDirOverride = options?.sessionStorage?.sandboxExportDir;
  const hostPath = (id: string): string => join(hostDir, `${id}.json`);
  return makeSessionFileStorage({
    hostRoot: hostDir,
    hostPath: (_cwd, id) => hostPath(id),
    // A no-sandbox run resumes from OpenCode's own database, which can't be
    // queried by id from here; OpenCode reports an unknown id itself.
    hostPathsById: (id) => [hostPath(id), opencodeHostDatabase()],
    sandboxPath: (_cwd, id, dirs) =>
      posix.join(exportDirOverride ?? dirs.tmp, `${id}.json`),
    sandboxExport: (id, path) =>
      `opencode export ${shellEscape(id)} > ${shellEscape(path)}`,
    sandboxImport: (_id, path) => `opencode import ${shellEscape(path)}`,
  });
};

export const opencode = (
  model: string,
  options?: OpenCodeOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "opencode",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeOpenCodeSessionStorage(options),

  buildPrintCommand({
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
    forkSession,
  }: AgentCommandOptions): PrintCommand {
    const variantFlag = options?.variant
      ? ` --variant ${shellEscape(options.variant)}`
      : "";
    const agentFlag = options?.agent
      ? ` --agent ${shellEscape(options.agent)}`
      : "";
    const permissionsFlag = dangerouslySkipPermissions
      ? " --dangerously-skip-permissions"
      : "";
    // `--fork` copies the session to a new id before continuing, leaving the
    // parent untouched; it needs `--session`.
    const sessionFlags =
      resumeSession === undefined
        ? ""
        : ` --session ${shellEscape(resumeSession)}${forkSession === true ? " --fork" : ""}`;
    return {
      command: `opencode run --format json --model ${shellEscape(model)}${variantFlag}${agentFlag}${permissionsFlag}${sessionFlags} ${shellEscape(prompt)}`,
    };
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["opencode", "--model", model];
    if (options?.agent) args.push("--agent", options.agent);
    // The TUI's seed-prompt flag is `--prompt` (long form only); `-p` is the
    // `opencode run`/`attach` basic-auth password flag, not a prompt seed.
    // Pre-fills the textbox but does not auto-submit (sst/opencode#3937).
    if (prompt) args.push("--prompt", prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseOpenCodeStreamLine(line);
  },
});

// ---------------------------------------------------------------------------
// GitHub Copilot CLI agent provider
// ---------------------------------------------------------------------------

/**
 * Copilot CLI print mode passes the prompt as the `-p` argv argument. (The CLI
 * can also read a prompt piped on stdin — `echo "..." | copilot` — but we use
 * the `-p` argv form here for parity with the tested print-command path.) Linux
 * enforces a per-argument limit (~128 KiB, ARG_MAX stack). Stay slightly under
 * so users get a clear error instead of spawn E2BIG. Mirrors the Cursor guard.
 */
const COPILOT_PRINT_PROMPT_MAX_BYTES = 120 * 1024;

const assertCopilotPrintPromptFitsArgv = (prompt: string): void => {
  const n = Buffer.byteLength(prompt, "utf8");
  if (n > COPILOT_PRINT_PROMPT_MAX_BYTES) {
    throw new Error(
      `Copilot print-mode prompt is ${n} bytes (max ${COPILOT_PRINT_PROMPT_MAX_BYTES} bytes). This provider passes the prompt as a command-line argument; shorten the prompt or split the work. Other Sandcastle providers use stdin for large prompts.`,
    );
  }
};

/**
 * Parse one line of `copilot --output-format json` JSONL output.
 *
 * Schema (observed via `copilot -p ... --output-format json --model ...`):
 *
 * - `assistant.message_delta` — `{ data: { messageId, deltaContent } }`
 *   Streaming chunks of assistant text. Mapped to `text` events.
 *
 * - `assistant.message` — `{ data: { messageId, content, toolRequests, ... } }`
 *   The complete assistant message. We surface its `content` as a `result`
 *   event so the Orchestrator's "last result wins" buffer ends up holding
 *   the final assistant text. (Tool calls in `toolRequests` are surfaced
 *   separately via `tool.execution_start` events.)
 *
 * - `tool.execution_start` — `{ data: { toolCallId, toolName, arguments } }`
 *   Mapped to `tool_call` events for allowlisted tools. Copilot uses lowercase
 *   `bash`; we normalise to the existing `Bash` allowlist entry.
 *
 * - `session.usage_checkpoint` — `{ data: { accountingSnapshot } }`
 *   `lastCallInputTokens` becomes a `context_window` event.
 *
 * - `result` — `{ sessionId, exitCode, usage }`
 *   Terminal event. We surface `sessionId` as a `session_id` event.
 *
 * - `error` / `agent_error` — defensive: surface as an `error` event the same
 *   way Pi/OpenCode do, so the Orchestrator fails the run with its message.
 */
const parseCopilotStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);

    // Streaming text deltas
    if (
      obj.type === "assistant.message_delta" &&
      typeof obj.data?.deltaContent === "string"
    ) {
      return [{ type: "text", text: obj.data.deltaContent }];
    }

    // Tool execution start → tool_call (allowlisted tools only)
    if (obj.type === "tool.execution_start") {
      const rawName = obj.data?.toolName;
      if (typeof rawName !== "string") return [];
      // Copilot CLI uses lowercase "bash"; normalise to the shared allowlist.
      const toolName = rawName === "bash" ? "Bash" : rawName;
      const argField = TOOL_ARG_FIELDS[toolName];
      if (argField === undefined) return [];
      const args = obj.data?.arguments as Record<string, unknown> | undefined;
      if (!args) return [];
      const argValue = args[argField];
      if (typeof argValue !== "string") return [];
      return [{ type: "tool_call", name: toolName, args: argValue }];
    }

    // Final assistant message → result. Each assistant turn emits one of
    // these with the complete text; the Orchestrator's resultText is
    // last-write-wins, so the final turn ends up surfaced to callers.
    if (
      obj.type === "assistant.message" &&
      typeof obj.data?.content === "string" &&
      obj.data.content.length > 0
    ) {
      return [{ type: "result", result: obj.data.content }];
    }

    // usage_checkpoint comes once near the end of a run. Use the last call's
    // input, never modelMetrics[...].usage.inputTokens, which sums all calls.
    if (obj.type === "session.usage_checkpoint") {
      return contextWindowEvent(
        obj.data?.accountingSnapshot?.lastCallInputTokens,
      );
    }

    // Terminal result event carries the session id
    if (obj.type === "result" && typeof obj.sessionId === "string") {
      return [{ type: "session_id", sessionId: obj.sessionId }];
    }

    // Defensive: surface error events as error events (matches Pi/OpenCode)
    if (obj.type === "error" || obj.type === "agent_error") {
      const msg = extractErrorMessage(obj);
      return msg ? [{ type: "error", message: msg }] : [];
    }
  } catch {
    // Not valid JSON — skip
  }
  return [];
};

/** Options for the GitHub Copilot CLI agent provider. */
export interface CopilotOptions {
  /** Reasoning effort level. Maps to the CLI's --effort flag. */
  readonly effort?: "low" | "medium" | "high";
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override Copilot `session-state` directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostSessionsDir?: string;
    readonly sandboxSessionsDir?: string;
  };
}

/**
 * Copilot's session is one `events.jsonl` keyed by id alone, so it moves as a
 * single file. The CLI resumes (`--resume=<id>`) but has no fork flag, so the
 * provider declares `canFork: false` (ADR 0021).
 */
const makeCopilotSessionStorage = (
  options?: CopilotOptions,
): AgentSessionStorage => {
  const hostDir =
    options?.sessionStorage?.hostSessionsDir ?? copilotHostSessionsDir();
  const sandboxDirOverride = options?.sessionStorage?.sandboxSessionsDir;
  const hostPath = (id: string): string => join(hostDir, id, "events.jsonl");
  return {
    ...makeSessionFileStorage({
      hostRoot: hostDir,
      hostPath: (_cwd, id) => hostPath(id),
      hostPathsById: (id) => [hostPath(id)],
      sandboxPath: (_cwd, id, dirs) =>
        copilotSessionPath(
          sandboxDirOverride ??
            posix.join(dirs.home, ".copilot", "session-state"),
          id,
        ),
      rewrite: transferCopilotSession,
    }),
    canFork: false,
  };
};

export const copilot = (
  model: string,
  options?: CopilotOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "copilot",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeCopilotSessionStorage(options),

  buildPrintCommand({
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
    forkSession,
  }: AgentCommandOptions): PrintCommand {
    if (resumeSession !== undefined && forkSession === true) {
      throw new ForkNotSupportedError({
        message:
          "copilot cannot fork a session: its CLI resumes but has no fork. Use resume() to continue the session in place.",
        agentProvider: "copilot",
      });
    }
    assertCopilotPrintPromptFitsArgv(prompt);
    const allowAll = dangerouslySkipPermissions ? " --allow-all-tools" : "";
    const effortFlag = options?.effort ? ` --effort ${options.effort}` : "";
    // `--resume` takes an optional value, so the id is bound with `=`.
    const resumeFlag =
      resumeSession === undefined
        ? ""
        : ` --resume=${shellEscape(resumeSession)}`;
    return {
      command: `copilot -p ${shellEscape(prompt)} --output-format json --model ${shellEscape(model)}${allowAll}${effortFlag}${resumeFlag}`,
    };
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["copilot", "--model", model];
    // Seed the interactive session with `-i`/`--interactive`, NOT `-p`. The
    // `-p`/`--prompt` flag runs the prompt programmatically and exits after
    // completion; since interactive() attaches these args to the real TTY,
    // `-p` would print-and-exit instead of launching the TUI. `-i` starts an
    // interactive session and auto-executes the prompt without exiting.
    if (prompt) args.push("-i", prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseCopilotStreamLine(line);
  },
});

// ---------------------------------------------------------------------------
// Claude Code agent provider
// ---------------------------------------------------------------------------

export interface ClaudeCodeOptions {
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override Claude session directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostProjectsDir?: string;
    readonly sandboxProjectsDir?: string;
  };
  /**
   * Maps directly to Claude's `--permission-mode` flag. When set, replaces the
   * default `--dangerously-skip-permissions` Sandcastle passes on AFK runs —
   * the two flags are mutually exclusive on Claude's CLI. Use `"auto"` for
   * AI-mediated per-tool approve/deny on unsandboxed host runs.
   */
  readonly permissionMode?:
    | "default"
    | "acceptEdits"
    | "plan"
    | "auto"
    | "dontAsk"
    | "bypassPermissions";
}

/** The `claude --print` command for a print-mode run. */
const buildClaudePrintCommand = (
  model: string,
  options: ClaudeCodeOptions | undefined,
  {
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
    forkSession,
  }: AgentCommandOptions,
): PrintCommand => {
  // permissionMode and --dangerously-skip-permissions are mutually exclusive
  // on Claude's CLI; an explicit mode on the provider takes precedence over
  // Sandcastle's default bypass.
  const skipPermissionsFlag = dangerouslySkipPermissions
    ? " --dangerously-skip-permissions"
    : "";
  const permissionFlag = options?.permissionMode
    ? ` --permission-mode ${options.permissionMode}`
    : skipPermissionsFlag;
  const effortFlag = options?.effort ? ` --effort ${options.effort}` : "";
  const resumeFlag = resumeSession
    ? ` --resume ${shellEscape(resumeSession)}`
    : "";
  // --fork-session is meaningful only alongside --resume; it tells Claude
  // to write the continuation as a new session rather than mutating the
  // resumed one. See ADR 0018.
  const forkFlag = resumeSession && forkSession ? " --fork-session" : "";
  return {
    command: `claude --print --verbose${permissionFlag} --output-format stream-json --model ${shellEscape(model)}${effortFlag}${resumeFlag}${forkFlag}`,
    stdin: prompt,
  };
};

/** The token usage of the last assistant message in a Claude session JSONL. */
const parseClaudeSessionUsage = (
  content: string,
): IterationUsage | undefined => {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant" && obj.message?.usage) {
        const u = obj.message.usage;
        if (
          typeof u.input_tokens === "number" &&
          typeof u.cache_creation_input_tokens === "number" &&
          typeof u.cache_read_input_tokens === "number" &&
          typeof u.output_tokens === "number"
        ) {
          return {
            inputTokens: u.input_tokens,
            cacheCreationInputTokens: u.cache_creation_input_tokens,
            cacheReadInputTokens: u.cache_read_input_tokens,
            outputTokens: u.output_tokens,
          };
        }
      }
    } catch {
      // Not valid JSON — skip
    }
  }
  return undefined;
};

export const claudeCode = (
  model: string,
  options?: ClaudeCodeOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "claude-code",
  env: options?.env ?? {},
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeClaudeSessionStorage(options),

  buildPrintCommand(commandOptions: AgentCommandOptions): PrintCommand {
    return buildClaudePrintCommand(model, options, commandOptions);
  },

  buildInteractiveArgs({
    prompt,
    dangerouslySkipPermissions,
  }: AgentCommandOptions): string[] {
    const args = ["claude"];
    if (options?.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    } else if (dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    args.push("--model", model);
    if (options?.effort) args.push("--effort", options.effort);
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return [...parseStreamJsonLine(line), ...parseClaudeContextWindow(line)];
  },

  parseSessionUsage(content: string): IterationUsage | undefined {
    return parseClaudeSessionUsage(content);
  },
});

// ---------------------------------------------------------------------------
// Mistral Vibe CLI agent provider
// ---------------------------------------------------------------------------

/** `value[key]` when `value` is an object. */
const recordField = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

/** `value[key]` when it is a string. */
const stringField = (value: unknown, key: string): string | undefined => {
  const field = recordField(value, key);
  return typeof field === "string" ? field : undefined;
};

/**
 * Vibe's allowlisted tool names (after stripping the unified harness's
 * `file_system.` prefix) mapped to the shared allowlist's canonical display
 * name and the display-arg fields to try, in order, on the effect's `input`.
 */
const VIBE_TOOLS: Record<
  string,
  { readonly name: string; readonly argFields: readonly string[] }
> = {
  bash: { name: "Bash", argFields: ["command"] },
  web_search: { name: "WebSearch", argFields: ["query"] },
  web_fetch: { name: "WebFetch", argFields: ["url"] },
  subagent: { name: "Agent", argFields: ["agent_name", "description"] },
  skill: { name: "Skill", argFields: ["skill", "name"] },
};

/**
 * Parse one line of `vibe -p --output streaming` NDJSON — one whole camelCase
 * history entry per line (a `PublicHistoryEntry`). Mapping (vibe 3.0.4):
 *
 * - `sessionId` on any entry → `session_id` (constant per run; last wins).
 * - `message`/`role=="assistant"` → `text` + `result` (text blocks joined
 *   `"\n\n"`); `outcome.type=="discarded"` entries are skipped.
 * - `effect` → `tool_call` for the allowlisted tools only, with the
 *   `file_system.` prefix stripped and the arg taken from the kind's input
 *   field (`shell` → `input.command`, `web_search` → `input.query`,
 *   `web_fetch` → `input.url`, `subagent` → `input.agent_name`, `skill` →
 *   skill name), falling back to `display.summary`. A `failed` state →
 *   `error` with `state.error.message`.
 * - `notice` with `level=="error"` → `error` with its `message`.
 *
 * `reasoning`/`checkpoint`/`callback` entries carry no displayable content.
 * No `usage`/`context_window` exists on the stream — both come from the
 * captured session journal (see parseVibeSessionUsage).
 */
const parseVibeStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  const events: ParsedStreamEvent[] = [];
  const sessionId = stringField(obj, "sessionId");
  if (sessionId !== undefined) {
    events.push({ type: "session_id", sessionId });
  }

  if (obj.type === "message" && obj.role === "assistant") {
    if (recordField(obj.outcome, "type") === "discarded") {
      return events;
    }
    const content = Array.isArray(obj.content) ? obj.content : [];
    const text = content
      .filter((block) => recordField(block, "type") === "text")
      .map((block) => stringField(block, "text") ?? "")
      .filter((part) => part !== "")
      .join("\n\n");
    if (text !== "") {
      events.push({ type: "text", text }, { type: "result", result: text });
    }
    return events;
  }

  if (obj.type === "effect") {
    if (recordField(obj.state, "status") === "failed") {
      const message =
        stringField(recordField(obj.state, "error"), "message") ??
        stringField(obj, "title") ??
        "vibe tool call failed";
      events.push({ type: "error", message });
      return events;
    }
    const rawName = stringField(obj.detail, "toolName");
    if (rawName === undefined) return events;
    const tool =
      VIBE_TOOLS[rawName.replace(/^file_system\./u, "").toLowerCase()];
    if (tool === undefined) return events; // not allowlisted
    let args: string | undefined;
    for (const field of tool.argFields) {
      const value = stringField(recordField(obj.detail, "input"), field);
      if (value !== undefined) {
        args = value;
        break;
      }
    }
    args ??= stringField(recordField(obj.detail, "display"), "summary");
    if (args !== undefined) {
      events.push({ type: "tool_call", name: tool.name, args });
    }
    return events;
  }

  if (obj.type === "notice" && recordField(obj, "level") === "error") {
    const message = stringField(obj, "message");
    if (message !== undefined) {
      events.push({ type: "error", message });
    }
    return events;
  }

  return events;
};

/**
 * The first `usage` object found in a parsed journal record: at the top
 * level, under `payload`, or under `payload.result` (where vibe 3.x puts the
 * model call's usage on an `action_result` record), with a bounded deep
 * search as a fallback for future nestings.
 */
const findVibeUsage = (
  value: unknown,
  depth = 0,
): Record<string, unknown> | undefined => {
  if (depth > 6 || !isRecord(value)) return undefined;
  if (isRecord(value.usage)) return value.usage;
  for (const key of Object.keys(value)) {
    if (key === "usage") continue;
    const found = findVibeUsage(value[key], depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * The `usage` object on the last line of the concatenated session journal
 * that carries one. Journal records are `{sequence, type, payload, …}`.
 */
const lastVibeJournalUsage = (
  content: string,
): Record<string, unknown> | undefined => {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    try {
      const usage = findVibeUsage(JSON.parse(line));
      if (usage !== undefined) {
        return usage;
      }
    } catch {
      // Not valid JSON — skip
    }
  }
  return undefined;
};

/**
 * Token usage from the captured vibe session: the LAST journal line with a
 * `usage` object is the last model call. Mapped codex-style — `input_tokens`
 * already includes the cached subset, so `inputTokens` is the remainder and
 * `cached_input_tokens` maps to `cacheReadInputTokens` (no double counting).
 */
const parseVibeSessionUsage = (content: string): IterationUsage | undefined => {
  const u = lastVibeJournalUsage(content);
  if (u === undefined) return undefined;
  if (
    typeof u.input_tokens !== "number" ||
    typeof u.output_tokens !== "number"
  ) {
    return undefined;
  }
  const cached =
    typeof u.cached_input_tokens === "number" ? u.cached_input_tokens : 0;
  return {
    inputTokens: u.input_tokens - cached,
    cacheCreationInputTokens:
      typeof u.cache_write_tokens === "number" ? u.cache_write_tokens : 0,
    cacheReadInputTokens: cached,
    outputTokens: u.output_tokens,
  };
};

/**
 * The last model call's context window from the captured session: the input
 * side of the last usage-bearing journal line, cache included (ADR 0023 —
 * one model call, never summed; no `limit`, vibe reports none).
 */
const parseVibeSessionContextWindow = (
  content: string,
): ContextWindow | undefined => {
  const tokens = lastVibeJournalUsage(content)?.input_tokens;
  return typeof tokens === "number" && tokens > 0 ? { tokens } : undefined;
};

/** The one session file whose cwd fields move on transfer; all others copy verbatim. */
const VIBE_META_JSON = "meta.json";

/** Journal segment names are 16-digit zero-padded sequence numbers. */
const VIBE_JOURNAL_FILE = /^[0-9]{16}\.jsonl$/u;

/**
 * vibe ≥ 3.1 pins each session's plugin environment (the generation's
 * `runtime-state.json` holds a `plugin_lock` naming content-addressed packages under
 * `$VIBE_HOME/logs/session/plugins/`) and refuses to resume when that shared
 * tree is missing (`plugin_snapshot_unavailable`, exit 2 — verified on 3.1.0).
 * So capture/resume move the `plugins/` sibling of the sessions root too,
 * verbatim; on the host it mirrors to `~/.vibe/logs/session/plugins`.
 */
const vibePluginsDirOf = (sessionsDir: string, isHost: boolean): string =>
  isHost
    ? join(dirname(sessionsDir), "plugins")
    : posix.join(posix.dirname(sessionsDir), "plugins");

/** Copy every file under a sandbox dir to a host dir; returns false when the source is absent. */
const captureVibeDir = async ({
  handle,
  sourceDir,
  destDir,
  fromCwd,
  toCwd,
  tag,
}: {
  handle: BindMountSandboxHandle;
  sourceDir: string;
  destDir: string;
  fromCwd: string;
  toCwd: string;
  tag: string;
}): Promise<boolean> => {
  const result = await handle.exec(`find ${JSON.stringify(sourceDir)} -type f`);
  const stdout = result.stdout.trim();
  if (result.exitCode !== 0 || stdout === "") {
    return false;
  }
  for (const file of stdout.split("\n")) {
    const rel = posix.relative(sourceDir, file);
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    if (rel === VIBE_META_JSON) {
      const content = await readSandboxFile(handle, file, tag);
      await writeFile(dest, transferVibeMetaJson(content, fromCwd, toCwd));
    } else {
      await handle.copyFileOut(file, dest);
    }
  }
  return true;
};

/** Copy every file under a host dir into a sandbox dir, rewriting only a root `meta.json`. */
const resumeVibeDir = async ({
  handle,
  hostDir,
  sandboxDir,
  fromCwd,
  toCwd,
  tag,
}: {
  handle: BindMountSandboxHandle;
  hostDir: string;
  sandboxDir: string;
  fromCwd: string;
  toCwd: string;
  tag: string;
}): Promise<void> => {
  for (const file of await listFilesRecursive(hostDir)) {
    const rel = relative(hostDir, file).split(/[\\/]/u).join("/");
    const dest = posix.join(sandboxDir, rel);
    if (rel === VIBE_META_JSON) {
      const content = await readFile(file, "utf8");
      await writeSandboxFile(handle, {
        sandboxPath: dest,
        content: transferVibeMetaJson(content, fromCwd, toCwd),
        tag,
      });
    } else {
      await handle.exec(`mkdir -p ${JSON.stringify(posix.dirname(dest))}`);
      await handle.copyFileIn(file, dest);
    }
  }
};

/**
 * Vibe's session is a whole directory (`unified/<id>/`: `meta.json`,
 * hash-chained `journal/*.jsonl`, content-addressed `chunks/`, …), so it
 * moves file-by-file through the handle's exec + single-file copy primitives
 * rather than `makeSessionFileStorage`. Only `meta.json` is rewritten (cwd
 * fields, sandbox-cwd ↔ host-cwd) — the journal references the chunks, so a
 * partial copy would corrupt resume. Child subagent dirs (`child-*`) are not
 * captured. The CLI resumes (`--resume <id>`) but has no print-mode fork, so
 * the provider declares `canFork: false` (ADR 0021).
 */
const makeVibeSessionStorage = (options?: VibeOptions): AgentSessionStorage => {
  const hostRoot =
    options?.sessionStorage?.hostSessionsDir ?? vibeHostSessionsDir();
  const sandboxRootOf = (handle: BindMountSandboxHandle): string =>
    options?.sessionStorage?.sandboxSessionsDir ??
    vibeSandboxSessionsDir(sandboxDirsOf(handle));

  return {
    canFork: false,
    hostSessionFilePath: (_cwd, id) => join(hostRoot, id),
    existsOnHost: (_cwd, id) => pathExists(join(hostRoot, id)),
    readHostSession: async (_cwd, id) => {
      const dir = join(hostRoot, id);
      if (!(await pathExists(dir))) return undefined;
      // The concatenated journal, in sequence order (zero-padded names sort
      // lexicographically), is what parseSessionUsage/parseSessionContextWindow read.
      const journalDir = join(dir, "journal");
      const segments = (await listFilesRecursive(journalDir))
        .filter((path) => VIBE_JOURNAL_FILE.test(posix.basename(path)))
        .sort();
      const parts: string[] = [];
      for (const segment of segments) {
        parts.push(await readFile(segment, "utf8"));
      }
      return parts.join("\n");
    },
    captureToHost: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const sandboxRoot = sandboxRootOf(handle);
      const sandboxDir = posix.join(sandboxRoot, sessionId);
      const hostDir = join(hostRoot, sessionId);
      const found = await captureVibeDir({
        handle,
        sourceDir: sandboxDir,
        destDir: hostDir,
        fromCwd: sandboxCwd,
        toCwd: hostCwd,
        tag: "vibe-cap",
      });
      if (!found) {
        throw new Error(`vibe session ${sessionId} not found in ${sandboxDir}`);
      }
      // The shared plugin package tree, when the sandbox has one (best-effort:
      // older vibe versions do not create it, and resume works without it).
      await captureVibeDir({
        handle,
        sourceDir: vibePluginsDirOf(sandboxRoot, false),
        destDir: vibePluginsDirOf(hostRoot, true),
        fromCwd: sandboxCwd,
        toCwd: hostCwd,
        tag: "vibe-plugins",
      });
    },
    resumeIntoSandbox: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const found = await findVibeSessionOnHost(sessionId, hostRoot);
      const hostDir = requireHostSessionPath(found, sessionId);
      const sandboxRoot = sandboxRootOf(handle);
      await resumeVibeDir({
        handle,
        hostDir,
        sandboxDir: posix.join(sandboxRoot, sessionId),
        fromCwd: hostCwd,
        toCwd: sandboxCwd,
        tag: "vibe-res",
      });
      // The pinned plugin environment a resumed session needs (vibe ≥ 3.1);
      // absent when the session was captured without one.
      const hostPlugins = vibePluginsDirOf(hostRoot, true);
      if (await pathExists(hostPlugins)) {
        await resumeVibeDir({
          handle,
          hostDir: hostPlugins,
          sandboxDir: vibePluginsDirOf(sandboxRoot, false),
          fromCwd: hostCwd,
          toCwd: sandboxCwd,
          tag: "vibe-plugins",
        });
      }
    },
    findByIdOnHost: (id) => findVibeSessionOnHost(id, hostRoot),
  };
};

/** Options for the Mistral Vibe CLI agent provider. */
export interface VibeOptions {
  /**
   * Environment variables injected by this agent provider. Merged over the
   * provider's own headless defaults (`VIBE_ENABLE_TELEMETRY=false`,
   * `VIBE_ENABLE_UPDATE_CHECKS=false`). `MISTRAL_API_KEY` stays the caller's.
   */
  readonly env?: Record<string, string>;
  /** When false, session capture is disabled. Default: true. */
  readonly captureSessions?: boolean;
  /** Override vibe session directories for tests or non-standard installs. */
  readonly sessionStorage?: {
    readonly hostSessionsDir?: string;
    readonly sandboxSessionsDir?: string;
  };
}

export const vibe = (
  model: string,
  options?: VibeOptions,
): AgentProvider & { readonly sessionStorage: AgentSessionStorage } => ({
  name: "vibe",
  env: {
    VIBE_ENABLE_TELEMETRY: "false",
    VIBE_ENABLE_UPDATE_CHECKS: "false",
    ...options?.env,
  },
  captureSessions: options?.captureSessions ?? true,
  sessionStorage: makeVibeSessionStorage(options),

  buildPrintCommand({
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
    forkSession,
  }: AgentCommandOptions): PrintCommand {
    if (resumeSession !== undefined && forkSession === true) {
      throw new ForkNotSupportedError({
        message:
          "vibe cannot fork a session: its CLI resumes but has no fork in print mode. Use resume() to continue the session in place.",
        agentProvider: "vibe",
      });
    }
    // Bare `-p` reads the prompt from stdin, dodging the argv size limit.
    // Headless vibe denies approval-needing tool calls while still exiting 0,
    // so `--auto-approve` is passed exactly when permissions are skipped.
    const autoApprove = dangerouslySkipPermissions ? " --auto-approve" : "";
    const resumeFlag =
      resumeSession === undefined
        ? ""
        : ` --resume ${shellEscape(resumeSession)}`;
    // vibe rejects `--model` combined with `--resume` ("--model only applies
    // to a new session"), so a resumed run keeps the session's own model.
    const modelFlag =
      resumeSession === undefined ? ` --model ${shellEscape(model)}` : "";
    return {
      command: `vibe -p --output streaming${modelFlag}${autoApprove}${resumeFlag}`,
      stdin: prompt,
    };
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["vibe", "--model", model];
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseVibeStreamLine(line);
  },

  parseSessionUsage(content: string): IterationUsage | undefined {
    return parseVibeSessionUsage(content);
  },

  parseSessionContextWindow(content: string): ContextWindow | undefined {
    return parseVibeSessionContextWindow(content);
  },
});
