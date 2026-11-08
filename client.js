/**
 * dsh-task-popup — Web client half.
 *
 * Watches the root Session stores:
 *   - a non-subagent Session that goes from running → idle is "task finished"
 *   - a Session whose pendingInteraction appears is "needs confirmation"
 *
 * Completion is debounced briefly so queued turns don't fire it early. Both
 * events show an in-app card in `shell.overlay`, plus a native notification
 * when the runtime allows it.
 *
 * Contract used (DSH 0.2.1-rc.5):
 *   - client plugin factory is registered through window.__ModuleLoader__
 *   - root slot entries receive the standard `useSessions` and
 *     `useSessionStatus` hooks
 *   - `ctx.locale.register(NS, { zh, en })` + slot `locale: NS` give the
 *     component a `t(key, params)` prop
 */

window.__ModuleLoader__.load({
  id: 'dsh-task-popup',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PLUGIN_ID = 'dsh-task-popup'
    const NS = 'taskPopup'
    const DONE_DEBOUNCE_MS = 1200
    const DONE_DISMISS_MS = 9000
    const PENDING_DISMISS_MS = 15000

    const zh = {
      'title': '任务已完成',
      'body': 'DeepSeek Harness 的一轮任务已经结束，点击查看结果',
      'pending.title': '需要你的确认',
      'pending.body': 'DSH 正在等待你确认一个操作，点击返回处理',
      'pending.bodyTool': '工具调用「{tool}」正在等待你确认，点击返回处理',
      'close': '关闭',
      'native.title': 'DeepSeek Harness · 任务已完成',
      'native.body': '一轮任务已经结束，点击返回对话查看结果',
      'native.pendingTitle': 'DeepSeek Harness · 需要你的确认',
      'native.pendingBody': 'DSH 正在等待你确认一个操作，点击返回处理',
    }

    const en = {
      'title': 'Task complete',
      'body': 'A DeepSeek Harness turn has finished. Click to view the result.',
      'pending.title': 'Confirmation needed',
      'pending.body': 'DSH is waiting for you to confirm an action. Click to handle it.',
      'pending.bodyTool': 'Tool call “{tool}” is waiting for your confirmation. Click to handle it.',
      'close': 'Dismiss',
      'native.title': 'DeepSeek Harness · Task complete',
      'native.body': 'A turn has finished. Click to return to the conversation.',
      'native.pendingTitle': 'DeepSeek Harness · Confirmation needed',
      'native.pendingBody': 'DSH is waiting for you to confirm an action. Click to handle it.',
    }

    function interpolate(template, params) {
      return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
        params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
      )
    }

    function fallbackTranslate(key, params) {
      const template = zh[key]
      return template === undefined ? key : interpolate(template, params)
    }

    function pendingKey(pending) {
      if (!pending || typeof pending !== 'object') return null
      return [
        pending.kind ?? 'pending',
        pending.toolName ?? pending.name ?? '',
        pending.callId ?? '',
      ].join(':')
    }

    /**
     * Turn running→idle into a notification (debounced), and pendingInteraction
     * appearing into a notification (immediate).
     */
    function useSessionNotifications(useSessions, useSessionStatus) {
      const sessions = useSessions((state) => state)
      const statuses = useSessionStatus((state) => state)
      const runningSeen = React.useRef(new Map())
      const pendingSeen = React.useRef(new Map())
      const doneTimer = React.useRef(null)
      const [notice, setNotice] = React.useState(null)

      React.useEffect(() => {
        if (!sessions || sessions.phase !== 'ready' || !sessions.byId) return
        const seen = runningSeen.current
        let finished = null
        let anyRunning = false

        for (const id of Object.keys(sessions.byId)) {
          const row = sessions.byId[id]
          if (!row || row.origin === 'subagent' || row.subagent) continue
          const running = row.running === true
          if (seen.get(id) === true && !running) finished = id
          if (running) anyRunning = true
          seen.set(id, running)
        }
        for (const id of [...seen.keys()]) {
          if (!sessions.byId[id]) seen.delete(id)
        }

        if (finished !== null) {
          if (doneTimer.current !== null) clearTimeout(doneTimer.current)
          doneTimer.current = setTimeout(() => {
            doneTimer.current = null
            setNotice({ kind: 'done', id: finished, at: Date.now() })
          }, DONE_DEBOUNCE_MS)
        } else if (anyRunning && doneTimer.current !== null) {
          // The same session picked up another queued turn; treat it as still busy.
          clearTimeout(doneTimer.current)
          doneTimer.current = null
        }
      }, [sessions, useSessions])

      React.useEffect(() => {
        if (!statuses || statuses.size === 0) return
        const seen = pendingSeen.current
        let pendingId = null
        let pendingTool = null

        for (const [id, status] of statuses) {
          const row = sessions && sessions.byId ? sessions.byId[id] : undefined
          if (!row || row.origin === 'subagent' || row.subagent) {
            seen.delete(id)
            continue
          }
          const pending = status && typeof status === 'object' ? status.pendingInteraction : null
          const key = pendingKey(pending)
          if (key !== null && seen.get(id) !== key) {
            pendingId = id
            pendingTool = pending && typeof pending === 'object' ? pending.toolName ?? pending.name ?? null : null
          }
          if (key === null) seen.delete(id)
          else seen.set(id, key)
        }
        for (const id of [...seen.keys()]) {
          if (!statuses.has(id)) seen.delete(id)
        }

        if (pendingId !== null) {
          if (doneTimer.current !== null) {
            clearTimeout(doneTimer.current)
            doneTimer.current = null
          }
          setNotice({ kind: 'pending', id: pendingId, tool: pendingTool, at: Date.now() })
        }
      }, [statuses, sessions])

      React.useEffect(() => () => {
        if (doneTimer.current !== null) clearTimeout(doneTimer.current)
      }, [])

      return [notice, () => setNotice(null)]
    }

    function useAutoDismiss(notice, dismiss) {
      React.useEffect(() => {
        if (!notice) return undefined
        const timeout = setTimeout(
          dismiss,
          notice.kind === 'pending' ? PENDING_DISMISS_MS : DONE_DISMISS_MS,
        )
        return () => clearTimeout(timeout)
      }, [notice, dismiss])
    }

    function useNativeNotification(notice, t) {
      React.useEffect(() => {
        if (!notice) return
        if (typeof Notification === 'undefined') return
        const title = notice.kind === 'pending' ? t('native.pendingTitle') : t('native.title')
        const body = notice.kind === 'pending' ? t('native.pendingBody') : t('native.body')

        const show = () => {
          try {
            const notification = new Notification(title, {
              body,
              tag: 'dsh-task-popup',
              renotify: true,
            })
            notification.onclick = () => {
              try {
                window.focus()
              } catch {
                // Browser focus is best effort.
              }
              notification.close()
            }
          } catch {
            // Native notifications are optional; the in-app card still shows.
          }
        }

        if (Notification.permission === 'granted') {
          show()
          return
        }
        if (Notification.permission === 'denied') return
        try {
          Promise.resolve(Notification.requestPermission())
            .then((permission) => {
              if (permission === 'granted') show()
            })
            .catch(() => {})
        } catch {
          // Older runtimes can throw synchronously.
        }
      }, [notice, t])
    }

    const styles = {
      card: {
        position: 'fixed',
        top: 'calc(var(--dsh-frame-top-clearance, 48px) + 12px)',
        right: '16px',
        zIndex: 2147483000,
        width: '340px',
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px 16px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.08))',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-elevated, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
        fontSize: '14px',
        lineHeight: '1.45',
        cursor: 'pointer',
        pointerEvents: 'auto',
      },
      icon: {
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        borderRadius: '999px',
        marginTop: '1px',
      },
      body: { flex: '1 1 auto', minWidth: '0' },
      title: {
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      },
      text: {
        marginTop: '2px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary, #5c6068)',
      },
      close: {
        flex: '0 0 auto',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, #8a8f98)',
        cursor: 'pointer',
        fontSize: '18px',
        lineHeight: '18px',
        padding: '2px 4px',
        borderRadius: '6px',
      },
    }

    const css = `
@keyframes dshTaskPopupIn {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.dsh-task-popup { animation: dshTaskPopupIn 180ms ease-out; }
`

    function CheckIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' },
        h('path', {
          d: 'M20 6L9 17l-5-5',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function BellIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' },
        h('path', {
          d: 'M12 3a6 6 0 0 0-6 6v3.2l-1.4 2.3A1 1 0 0 0 5.5 16h13a1 1 0 0 0 .9-1.5L18 12.2V9a6 6 0 0 0-6-6Z',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M10 19a2 2 0 0 0 4 0',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
      )
    }

    function TaskPopupHost(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackTranslate
      const [notice, dismiss] = useSessionNotifications(props.useSessions, props.useSessionStatus)
      useAutoDismiss(notice, dismiss)
      useNativeNotification(notice, t)

      if (!notice) return null

      const pending = notice.kind === 'pending'
      const iconStyle = pending
        ? {
            ...styles.icon,
            background: 'var(--dsw-alias-bg-warning, rgba(245, 158, 11, 0.14))',
            color: 'var(--dsw-alias-label-warning, #d97706)',
          }
        : {
            ...styles.icon,
            background: 'var(--dsw-alias-bg-brand, rgba(77, 107, 254, 0.12))',
            color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
          }

      const title = pending ? t('pending.title') : t('title')
      const body = pending
        ? notice.tool
          ? t('pending.bodyTool', { tool: notice.tool })
          : t('pending.body')
        : t('body')

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, css),
        h(
          'div',
          {
            key: 'card',
            className: 'dsh-task-popup',
            style: styles.card,
            role: 'status',
            'aria-live': 'polite',
            onClick: () => {
              try {
                window.focus()
              } catch {
                // Ignore focus failures.
              }
              dismiss()
            },
          },
          h('div', { style: iconStyle, 'aria-hidden': 'true' }, pending ? h(BellIcon) : h(CheckIcon)),
          h(
            'div',
            { style: styles.body },
            h('div', { style: styles.title }, title),
            h('div', { style: styles.text }, body),
          ),
          h(
            'button',
            {
              type: 'button',
              style: styles.close,
              'aria-label': t('close'),
              title: t('close'),
              onClick: (event) => {
                event.stopPropagation()
                dismiss()
              },
            },
            '×',
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-task-popup: dictionaries')
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: PLUGIN_ID,
              order: 100,
              locale: NS,
            },
            TaskPopupHost,
          ),
        )
      },
    }
  },
})
