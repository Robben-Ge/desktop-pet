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
拖动右下角缩放手柄 -> 放大/缩小宠物
```

## 设置页

设置页可以：

```text
选择 C:\Users\J2441\.codex\pets 下的正式宠物包
选择 C:\Users\J2441\.codex\pet-runs 下的生成调试包
手动测试 Codex 固定 9 行动作
通过尺寸按钮设置 75% / 100% / 125% / 150%
查看 API 地址、pets 目录、pet-runs 目录和本应用设置文件
```

选择的宠物、桌面窗口位置和缩放比例会保存到 Electron 的 userData 设置文件。

## API

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:17861/health
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
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json" `
  -Body '{"state":"working","message":"Codex 正在敲代码"}'
```

短暂提醒后自动回到待机：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json" `
  -Body '{"state":"done","message":"任务完成","durationMs":3000}'
```

切状态时顺带切宠物：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17861/state `
  -ContentType "application/json" `
  -Body '{"petKey":"pet-runs:xiao-jin","state":"thinking","message":"正在思考"}'
```

## 结构

```text
src/main.js                  Electron 主进程，扫描 Codex 宠物包、管理窗口、提供 HTTP API
src/preload.js               安全 IPC 桥接
src/renderer/index.html      透明桌面宠物窗口
src/renderer/renderer.js     Codex spritesheet 播放器和拖拽动作
src/renderer/styles.css      桌面宠物窗口样式
src/renderer/settings.html   设置页
src/renderer/settings.js     设置页逻辑
src/renderer/settings.css    设置页样式
```
