import { createPortal } from 'react-dom'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { Button } from '../shared/Button'

/**
 * Top-level permission overlay that renders as a modal portal
 * whenever there's a pending permission request.
 */
export function PermissionOverlay() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined,
  )
  const respondToPermission = useChatStore((s) => s.respondToPermission)

  if (!pendingPermission) return null

  const { requestId, toolName, input, description } = pendingPermission

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-[540px] mx-4 rounded-lg border border-yellow-500 bg-white shadow-xl">
        <div className="flex items-center gap-3 px-5 py-4 bg-gray-50 rounded-t-lg">
          <div className="text-lg font-semibold text-gray-900">
            Allow {toolName}?
          </div>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">
            Awaiting approval
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="text-sm text-gray-500 truncate">
            {input && typeof input === 'object' && 'file_path' in input
              ? String((input as any).file_path)
              : toolName}
          </div>
          {description && (
            <p className="mt-1 text-xs text-gray-400">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-5 py-3 bg-gray-50 rounded-b-lg">
          <Button
            variant="primary"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true)}
          >
            Allow
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true, { rule: 'always' })}
          >
            Always Allow
          </Button>
          <div className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, false)}
          >
            Deny
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
