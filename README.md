# dsh-task-popup

[![ci](https://github.com/methylorange/dsh-task-popup/actions/workflows/ci.yml/badge.svg)](https://github.com/methylorange/dsh-task-popup/actions/workflows/ci.yml)

在 DeepSeek Harness 的一轮任务结束（Session 从运行中变为空闲），或者出现**待确认操作**（审批、提问、计划评审）时，弹出一个提示卡片；如果运行环境允许，再补一条系统通知。

## 效果

- 任务结束：页面右上角出现卡片 **任务已完成 / 一轮任务已经结束，点击查看结果**
- 待确认：页面右上角出现卡片 **需要你的确认 / DSH 正在等待你确认一个操作，点击返回处理**（能拿到工具名时会带上工具名）
- 完成卡片 9 秒后自动消失，待确认卡片 15 秒后自动消失；都可以点 × 关闭
- 点击卡片会尝试把窗口拉到前台
- Electron 桌面版 / 允许通知的浏览器里，同时发一条原生通知
- 不会为子智能体（subagent）的会话弹窗，只通知主会话

## 判定逻辑

读取 Web 客户端根标准的两个 Hook：

- `useSessions`：某个**非子智能体** Session 的 `running` 从 `true` 变成 `false`
  - 等待 1.2 秒确认它没有立刻开始下一轮（排队消息/连续 turn 不会误报）
  - 然后显示「任务已完成」
- `useSessionStatus`：某个**非子智能体** Session 的 `pendingInteraction` 从空变为存在
  - 立即显示「需要你的确认」
  - 审批（approval）、ask_user_question、计划评审都走这个状态

不需要改 Host 逻辑，也不写 Session 事件；只是订阅已有的 Sessions / SessionStatus 状态。

## 安装

### 方式一：从 GitHub 克隆（普通 profile）

```powershell
git clone https://github.com/methylorange/dsh-task-popup
dsh plugin --profile web add file:C:/path/to/dsh-task-popup
```

把 `C:/path/to/dsh-task-popup` 换成实际克隆路径。

### 方式二：Desktop 版

在 DSH 的插件管理页面选择本目录安装，或通过插件管理器：

```text
plugin_manager install_bundle  target = C:\path\to\dsh-task-popup
```

安装后刷新页面，或重启 DSH 客户端，让客户端插件重新加载。

卸载：`plugin_manager remove_bundle target = dsh-task-popup`，或在插件管理页面移除。

## 开发与自测

插件没有构建步骤，`client.js` 就是浏览器端产物。需要 Node 22+：

```powershell
npm test
```

CI 会跑 `node --check client.js` 和同一份自测。

## 可调参数

在 `client.js` 顶部：

- `DONE_DEBOUNCE_MS = 1200`：任务完成后的确认等待；想更快可改小
- `DONE_DISMISS_MS = 9000`：完成卡片自动消失时间
- `PENDING_DISMISS_MS = 15000`：待确认卡片自动消失时间
- 原生通知：在 `useNativeNotification` 里，不想要可以删掉对应调用

## 限制

- 只有 DSH Web 客户端已加载、页面在运行时才会弹卡片；窗口最小化/隐藏时看不到页面卡片，但原生通知仍可能弹出（取决于系统和通知权限）。
- 原生通知依赖浏览器/Electron 的 Notification 权限；被拒绝时静默跳过，卡片不受影响。
- 只有主会话会通知；子智能体会话完成不弹。
- 待确认卡片依赖 `useSessionStatus` 提供的 `pendingInteraction`；如果某个确认方式没有登记为 pending interaction，就不会弹（DSH 内置的审批/提问/计划评审都会登记）。
- 这是社区插件，升级 DSH 后如果槽位或标准 Hook 变化，可能需要跟着调整。

## License

MIT
