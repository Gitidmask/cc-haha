/**
 * SDK ConversationService — powered by @anthropic-ai/claude-agent-sdk
 *
 * Replaces the CLI subprocess model with direct in-process SDK calls.
 * Each desktop session interacts with the SDK's query() function directly.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ProviderService } from './providerService.js'
import { sessionService } from './sessionService.js'
import { diagnosticsService } from './diagnosticsService.js'

const MAX_CAPTURED_SDK_MESSAGES = 40

/**
 * Resolve the SDK's native Claude Code CLI binary path.
 *
 * The @anthropic-ai/claude-agent-sdk needs a native CLI binary at runtime.
 * Bun.build --compile bundles JS but not native executables from node_modules,
 * so build-sidecars.ts copies the appropriate platform binary alongside the
 * sidecar. This function discovers it from the sidecar's own executable path:
 *
 *   sidecar:  .../claude-sidecar-x86_64-pc-windows-msvc.exe
 *   SDK CLI:  .../claude-sdk-cli-x86_64-pc-windows-msvc.exe
 */
function resolveSdkCliPath(): string | undefined {
  const execPath = process.execPath
  if (!execPath) return undefined

  const basename = path.basename(execPath)
  const sdkCliName = basename.replace('sidecar', 'sdk-cli')
  if (sdkCliName === basename) return undefined

  return path.join(path.dirname(execPath), sdkCliName)
}

type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
}

type OutputCallback = (msg: any) => void

type SessionState = {
  workDir: string
  permissionMode: string
  model: string
  providerId: string | null
  abortController: AbortController
  outputCallbacks: OutputCallback[]
  pendingPermissionResolvers: Map<string, (decision: any) => void>
  isGenerating: boolean
  recentSdkMessages: any[]
  initMessage: any | null
  sdkSessionId: string | null
}

type SessionStartOptions = {
  permissionMode?: string
  model?: string
  effort?: string
  thinking?: 'enabled' | 'adaptive' | 'disabled'
  providerId?: string | null
}

export class ConversationStartupError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'ConversationStartupError'
  }
}

export class ConversationService {
  private sessions = new Map<string, SessionState>()
  private deletedSessions = new Set<string>()
  private providerService = new ProviderService()

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSessionWorkDir(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.workDir ?? null
  }

  getSessionPermissionMode(sessionId: string): string {
    return this.sessions.get(sessionId)?.permissionMode ?? 'default'
  }

  getRecentSdkMessages(sessionId: string): any[] {
    return this.sessions.get(sessionId)?.recentSdkMessages ?? []
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  async startSession(
    sessionId: string,
    workDir: string,
    _sdkUrl: string,
    options?: SessionStartOptions,
  ): Promise<void> {
    if (this.deletedSessions.has(sessionId)) {
      throw new ConversationStartupError(
        'Session was deleted before startup completed',
        'SESSION_DELETED',
      )
    }

    if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
      throw new ConversationStartupError(
        `Working directory does not exist: ${workDir}`,
        'WORKDIR_INVALID',
      )
    }

    this.sessions.set(sessionId, {
      workDir,
      permissionMode: options?.permissionMode ?? 'default',
      model: options?.model ?? 'sonnet',
      providerId: options?.providerId ?? null,
      abortController: new AbortController(),
      outputCallbacks: [],
      pendingPermissionResolvers: new Map(),
      isGenerating: false,
      recentSdkMessages: [],
      initMessage: null,
      sdkSessionId: null,
    })
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.abortController.abort()
      this.sessions.delete(sessionId)
    }
  }

  async stopSessionAndWait(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.abortController.abort()
      // Small delay to let abort propagate
      await new Promise((resolve) => setTimeout(resolve, 100))
      this.sessions.delete(sessionId)
    }
  }

  sendMessage(
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Handle file/image attachments by including paths in the prompt
    let fullPrompt = content
    if (attachments && attachments.length > 0) {
      const attachmentLines = attachments
        .filter((a) => a.path)
        .map((a) => `[${a.type === 'image' ? 'Image' : 'File'}: ${a.path}]`)
      if (attachmentLines.length > 0) {
        fullPrompt = `${content}\n\n${attachmentLines.join('\n')}`
      }
    }

    session.isGenerating = true

    // Run the query asynchronously
    this.executeQuery(sessionId, session, fullPrompt).catch((err) => {
      if (err?.name === 'AbortError') return
      void diagnosticsService.recordEvent({
        type: 'sdk_query_failed',
        severity: 'error',
        sessionId,
        summary: err instanceof Error ? err.message : String(err),
      })
      console.error(`[SDK] Query failed for ${sessionId}:`, err)
      session.isGenerating = false
      this.forwardToCallbacks(session, {
        type: 'error',
        message: err instanceof Error ? err.message : 'SDK query failed',
        code: 'SDK_ERROR',
      })
    })

    return true
  }

  private async executeQuery(
    sessionId: string,
    session: SessionState,
    prompt: string,
  ): Promise<void> {
    // Build SDK options
    const sdkOptions: any = {
      prompt,
      options: {
        cwd: session.workDir,
        model: session.model,
        permissionMode: session.permissionMode === 'bypassPermissions'
          ? undefined
          : session.permissionMode,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['project', 'user', 'local'],
        signal: session.abortController.signal,
        env: { ...process.env },
      },
    }

    // Resume previous session if we have one
    if (session.sdkSessionId) {
      sdkOptions.options.resume = session.sdkSessionId
    }

    // Handle permission mode
    if (session.permissionMode === 'bypassPermissions') {
      sdkOptions.options.permissionMode = 'bypassPermissions'
    } else {
      // Add permission hook
      sdkOptions.options.hooks = {
        canUseTool: async (toolName: string, input: any, context: any) => {
          return this.handleToolPermission(session, toolName, input, context)
        },
      }
    }

    // Add allowed tools
    sdkOptions.options.tools = { type: 'preset', preset: 'claude_code' }

    // Point the SDK to the bundled native CLI binary (bundled alongside sidecar)
    const sdkCliPath = resolveSdkCliPath()
    if (sdkCliPath) {
      sdkOptions.options.pathToClaudeCodeExecutable = sdkCliPath
    }

    try {
      const gen = query(sdkOptions)

      for await (const message of gen) {
        // Track SDK session ID from first response
        if (message.session_id && !session.sdkSessionId) {
          session.sdkSessionId = message.session_id
        }

        // Store recent messages for debugging/reconnection
        session.recentSdkMessages.push(message)
        if (session.recentSdkMessages.length > MAX_CAPTURED_SDK_MESSAGES) {
          session.recentSdkMessages.shift()
        }

        // Forward to callbacks (which forward to WebSocket)
        this.forwardToCallbacks(session, message)
      }
    } finally {
      session.isGenerating = false
    }
  }

  private async handleToolPermission(
    session: SessionState,
    toolName: string,
    input: any,
    context: any,
  ): Promise<any> {
    // Create a unique request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Send control_request matching CLI format so translateCliMessage can handle it
    this.forwardToCallbacks(session, {
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: toolName,
        tool_use_id: context?.toolUseId,
        input,
        description: context?.description,
      },
    })

    // Wait for the permission response
    const decision = await new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        session.pendingPermissionResolvers.delete(requestId)
        resolve(null) // timeout = deny
      }, 55000)

      session.pendingPermissionResolvers.set(requestId, (response) => {
        clearTimeout(timeout)
        resolve(response)
      })
    })

    if (!decision) {
      return { behavior: 'deny', message: 'Permission request timed out' }
    }

    if (!decision.allowed) {
      return { behavior: 'deny', message: decision.message ?? 'User denied' }
    }

    return { behavior: 'allow', updatedInput: decision.updatedInput ?? input }
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    rule?: string,
    updatedInput?: Record<string, unknown>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    const resolver = session.pendingPermissionResolvers.get(requestId)
    if (!resolver) return false

    resolver({ allowed, rule, updatedInput })
    session.pendingPermissionResolvers.delete(requestId)
    return true
  }

  sendInterrupt(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Abort current generation
    session.isGenerating = false
    // Create a new abort controller for next query
    session.abortController.abort()
    session.abortController = new AbortController()
    return true
  }

  setPermissionMode(sessionId: string, mode: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.permissionMode = mode
    return true
  }

  // Output callbacks — the bridge to WebSocket handler
  onOutput(
    sessionId: string,
    callback: OutputCallback,
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.outputCallbacks.push(callback)
  }

  clearOutputCallbacks(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.outputCallbacks = []
  }

  private forwardToCallbacks(session: SessionState, message: any): void {
    for (const cb of session.outputCallbacks) {
      try {
        cb(message)
      } catch (err) {
        console.error('[SDK] Output callback error:', err)
      }
    }
  }

  // SDK bridge methods — kept for interface compatibility, no-ops in SDK mode
  authorizeSdkConnection(_sessionId: string, _token: string | null): boolean {
    return false // SDK mode doesn't use the bridge
  }

  attachSdkConnection(_sessionId: string, _ws: any): void {
    // No-op
  }

  handleSdkPayload(_sessionId: string, _payload: string): void {
    // No-op
  }

  detachSdkConnection(_sessionId: string): void {
    // No-op
  }
}

export const conversationService = new ConversationService()
