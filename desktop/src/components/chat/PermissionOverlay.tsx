import { createPortal } from 'react-dom'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'

/**
 * Top-level permission overlay that renders as a modal portal
 * whenever there's a pending permission request, regardless of
 * where it appears in the message list.
 */
export function PermissionOverlay() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined,
  )
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const t = useTranslation()

  if (!pendingPermission) return null

  const { requestId, toolName, input, description } = pendingPermission

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Card */}
      <div className="relative w-full max-w-[540px] mx-4 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-surface-container-lowest)] shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-[var(--color-surface-container)] rounded-t-[var(--radius-lg)]">
          <div className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-warning)]/15">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-warning)]">
              {toolName === 'Bash' ? 'terminal' : toolName === 'Write' ? 'edit_document' : toolName === 'Edit' ? 'edit_note' : 'shield'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                {toolName === 'Write' || toolName === 'Edit'
                  ? `允许 ${toolName === 'Write' ? '写入' : '编辑'} 文件`
                  : `允许使用 ${toolName} 工具`}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                等待批准
              </span>
            </div>
            {description && (
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] truncate">{description}</p>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="px-5 py-4 border-t border-[var(--color-outline-variant)]/20">
          {toolName === 'Bash' && input && typeof input === 'object' && 'command' in input ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5">
              <pre className="font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
                <span className="text-[var(--color-terminal-accent)] select-none">$ </span>
                {(input as any).command}
              </pre>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container)] px-3 py-2 text-xs font-[var(--font-mono)] text-[var(--color-text-secondary)]">
              <span className="material-symbols-outlined text-[14px] text-[var(--color-outline)] flex-shrink-0">folder_open</span>
              <span className="truncate">
                {input && typeof input === 'object' && 'file_path' in input
                  ? (input as any).file_path
                  : toolName}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-5 py-3 rounded-b-[var(--radius-lg)]">
          <Button
            variant="primary"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true)}
            icon={<span className="material-symbols-outlined text-[14px]">check</span>}
          >
            {t('permission.allow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true, { rule: 'always' })}
            icon={<span className="material-symbols-outlined text-[14px]">verified</span>}
          >
            {t('permission.allowForSession')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, false)}
            icon={<span className="material-symbols-outlined text-[14px]">close</span>}
          >
            {t('permission.deny')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
