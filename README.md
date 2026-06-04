# Desktop Pet Agent

这是一个把 Codex 软件里的“设置 -> 外观 -> 宠物”runtime 单独拆出来的 MVP。

它直接读取本机 Codex 宠物包：

```text
C:\Users\J2441\.codex\pets
C:\Users\J2441\.codex\pet-runs
```

`pets` 是正式安装包，`pet-runs` 是生成/调试包。两边都会显示；同名宠物用 `pets:<id>` 和 `pet-runs:<id>` 区分。

## 运行

```powershell
npm install
npm start
```

默认 API：

```text
http://127.0.0.1:17861
```

可用环境变量：

```powershell
$env:PET_PORT=17862
$env:PET_ID="yinienie"
npm start
```

## Codex 图集契约

Codex 宠物是固定图集，不是任意动画文件：

```text
1536x1872 WebP/PNG
8 columns x 9 rows
cell: 192x208
background: transparent
```

固定 9 行状态：

```text
idle           -> idle 待机
running-right  -> 向右拖拽移动
running-left   -> 向左拖拽移动
waving         -> 挥手/提醒
jumping        -> done 开心跳一下
failed         -> sleeping 趴下睡觉
waiting        -> waiting 等待输入
running        -> working 敲代码中
review         -> thinking 歪头思考
```

业务别名：

```text
start    -> waving
success  -> jumping
done     -> jumping
sleeping -> failed
working  -> running
thinking -> review
```

桌面交互：

```text
拖动宠物向右 -> running-right
拖动宠物向左 -> running-left
松开拖拽     -> 恢复拖拽前状态
双击宠物     -> 打开设置页
托盘 Settings -> 打开设置页
idle 状态下鼠标移入宠物 -> 显示固定尺寸缩放手柄
拖动右下角缩放手柄 -> 放大/缩小宠物
非 idle 状态 -> 隐藏缩放手柄
消息气泡 -> 独立透明窗口，自动避让屏幕边缘
```

## 设置页

设置页可以：

```text
选择 C:\Users\J2441\.codex\pets 下的正式宠物包
选择 C:\Users\J2441\.codex\pet-runs 下的生成调试包
手动测试 Codex 固定 9 行动作
通过尺寸按钮设置 75% / 100% / 125% / 150%
通过气泡大小按钮单独设置 85% / 100% / 120% / 140%
查看 API 地址、pets 目录、pet-runs 目录和本应用设置文件
```

选择的宠物、桌面窗口位置、宠物缩放比例和气泡大小会保存到 Electron 的 userData 设置文件。气泡大小独立于宠物缩放。

气泡使用独立的 `BubbleWindow`，不再塞在宠物窗口内部。显示消息时会根据宠物窗口所在屏幕的 `workArea` 自动计算位置：优先显示在宠物上方，顶部空间不够时翻到下方，左右超出时 clamp 回屏幕内部。

## API

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:17861/health
```

查看当前 agent 会话聚合：

```powershell
Invoke-RestMethod http://127.0.0.1:17861/sessions
```

列出宠物：

```powershell
Invoke-RestMethod http://127.0.0.1:17861/pets
```

选择宠物：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/pet/select `
  -ContentType "application/json" `
  -Body '{"key":"pets:yinienie"}'
```

切换状态：

```powershell
$body = '{"state":"working","message":"Codex 正在敲代码"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

短暂提醒后自动回到待机：

```powershell
$body = '{"state":"done","message":"任务完成","durationMs":3000}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

切状态时顺带切宠物：

```powershell
$body = '{"petKey":"pet-runs:xiao-jin","state":"thinking","message":"正在思考"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

Windows PowerShell 5.1 里不要直接把中文 JSON 字符串传给 `-Body`，它可能按系统默认编码发送，气泡会显示 `????`。上面的写法会明确发送 UTF-8 字节。

## Agent event 协议

这一层参考了两个方向：

```text
Clawd on Desk -> 多 agent hook 输入、会话状态聚合、优先级状态机
OpenPets      -> 稳定的事件/反应协议，方便后续扩展 Claude、Codex、CodeBuddy
```

当前阶段先实现本地事件入口和状态机，不自动修改 `~/.claude`、`~/.codex` 或 CodeBuddy 配置。后续接真实 hook 时，只要让 hook 向 `/events` 发事件即可。

通用事件格式：

```json
{
  "source": "claude-code",
  "event": "tool_start",
  "sessionId": "optional-session-id",
  "message": "Claude 正在执行工具"
}
```

支持的 `source`：

```text
claude-code
codex
codebuddy
opencode
openpets
```

支持的通用事件：

```text
session_start -> 挥手一下，并把会话放入 review
task_start    -> review
prompt        -> review
tool_start    -> running；测试命令会映射为 waiting
tool_end      -> review
waiting       -> waiting
notification  -> 挥手提醒
done          -> jumping，然后回到其他活跃会话或 idle
failed        -> failed，然后回到其他活跃会话或 idle
session_end   -> 清理会话
```

也支持 OpenPets 风格的 `reaction`：

```text
thinking -> review
working/editing/running -> running
testing/waiting -> waiting
waving -> waving
success/celebrating -> jumping
error -> failed
```

发送通用事件：

```powershell
$body = '{"source":"claude-code","event":"tool_start","sessionId":"demo","message":"Claude 正在执行工具"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/events `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

直接发送 Claude/CodeBuddy 兼容 hook payload：

```powershell
$body = '{"source":"codebuddy","hook_event_name":"Stop","session_id":"demo","message":"CodeBuddy 完成了"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/events `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

直接发送 OpenPets reaction：

```powershell
$body = '{"source":"openpets","reaction":"thinking","sessionId":"demo"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/events `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

清空当前 agent 会话：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:17861/sessions/clear
```

单独调整气泡大小：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/bubble/resize `
  -ContentType "application/json" `
  -Body '{"bubbleScale":1.2}'
```

## 结构

```text
src/main.js                  Electron 主进程，扫描 Codex 宠物包、管理窗口、提供 HTTP API
src/agent-events.js          agent/hook 事件归一化和 Codex 9 行动作映射
src/session-manager.js       多 agent 会话状态聚合和优先级选择
src/preload.js               安全 IPC 桥接
src/renderer/index.html      透明桌面宠物窗口
src/renderer/renderer.js     Codex spritesheet 播放器和拖拽动作
src/renderer/styles.css      桌面宠物窗口样式
src/renderer/bubble.html     独立消息气泡窗口
src/renderer/bubble.js       气泡测量和消息渲染
src/renderer/bubble.css      气泡样式
src/renderer/settings.html   设置页
src/renderer/settings.js     设置页逻辑
src/renderer/settings.css    设置页样式
```
