# Our Pets

<p align="center">
  <img src="src/assets/logo.svg" width="132" height="132" alt="Our Pets 桌宠图标" />
</p>

<p align="center">
  <strong>把一点陪伴、提醒和好心情放在桌面上。</strong><br />
  切换喜欢的角色，安排温柔的问候，让工作区多一点生气。
</p>

<p align="center">
  <a href="README.md">English README</a> ·
  <a href="https://github.com/Robben-Ge/desktop-pet/releases">下载最新版本</a>
</p>

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/assets/readme/characters.svg" width="52" height="52" alt="角色" /><br />
      <strong>角色库</strong><br />
      <sub>内置三位桌宠，也支持导入自己的精灵图。</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/readme/interaction.svg" width="52" height="52" alt="问候和提醒" /><br />
      <strong>日常互动</strong><br />
      <sub>问候、健康提醒和恰到好处的动作反馈。</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/readme/control.svg" width="52" height="52" alt="控制和设置" /><br />
      <strong>自己掌控</strong><br />
      <sub>拖动、缩放、托盘菜单与细致的设置项。</sub>
    </td>
  </tr>
</table>

Our Pets 是一个独立的 Electron 桌面宠物。它悬浮在桌面上，不占用任务栏入口；常驻功能都在系统托盘中，重点是陪伴、提醒和可自定义角色。

## 开始使用

### 安装发布版

从 [GitHub Releases](https://github.com/Robben-Ge/desktop-pet/releases) 下载最新版 Windows x64 安装包或 macOS zip。打包后的应用可以在设置页检查 GitHub Releases 的更新。

### 从源码运行

```bash
npm install
npm start
```

本地启动时可以指定内置角色：

```bash
PET_ID=danna-graduation npm start
```

当前内置角色 ID：`danna-graduation`、`danna-dress`、`robben`、`robben-plaid`、`dan-black-dress`。

## 日常使用

| 想做什么 | 怎么操作 |
| --- | --- |
| 移动桌宠 | 用主鼠标键拖动；它会朝移动方向跑动。 |
| 给它一点反馈 | 点击桌宠，它会短暂跳跃。 |
| 调整大小 | 让空闲桌宠显示缩放手柄，再拖动手柄。范围为 65%–240%。 |
| 打开设置 | 双击桌宠，或从托盘菜单选择 **设置**。 |
| 隐藏、切换或退出 | 使用系统托盘菜单；其中也有“说一句”、开机自启动和免打扰。 |

设置页还能调整气泡大小（75%–160%）、角色库、更新检查、问候任务和提醒细节。消息气泡会跟随桌宠，并在靠近屏幕边缘时自动调整位置。

## 角色与自定义宠物

应用内置五位角色：

| 角色 | ID | 简介 |
| --- | --- | --- |
| Danna · 毕业袍 | `danna-graduation` | 默认角色，穿着学士服的 Danna。 |
| Danna · 长裙 | `danna-dress` | 更日常、温柔的 Danna 造型。 |
| Robben | `robben` | 陪你写代码、休息和发呆的桌面伙伴。 |
| Robben · 格纹衬衫 | `robben-plaid` | 格纹衬衫与斜挎包的日常造型。 |
| Dan · 黑裙 | `dan-black-dress` | 长黑发、黑裙和薄荷绿手机的优雅日常造型。 |

导入角色时，打开 **设置 → 自定义宠物 → 选择文件夹**。所选目录的每个一级子目录都会被当作一个角色，只要其中有有效的清单和精灵图：

```text
my-pet/
  pet.json
  spritesheet.webp
```

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "一个桌面伙伴。",
  "spritesheetPath": "spritesheet.webp"
}
```

播放器使用固定的 V2 图集：`1536 × 2288 px`、8 列、11 行，每格 `192 × 208 px`。精灵图可以是 WebP 或 PNG。当前播放器使用第 0–8 行作为可见动作；最后两行保留在图集格式中。

| 行 | 动作 | 用途 |
| --- | --- | --- |
| 0 | `idle` | 空闲站立 |
| 1 | `running-right` | 向右拖动 |
| 2 | `running-left` | 向左拖动 |
| 3 | `waving` | 问候和提醒 |
| 4 | `jumping` | 点击或开心时刻 |
| 5 | `failed` | 休息 / 睡觉 |
| 6 | `waiting` | 等待 |
| 7 | `running` | 忙碌 |
| 8 | `review` | 思考 |

设置页的动作测试区可以预览每一种可见动作。

## 问候、提醒与更新

默认问候任务包括启动时、09:00、12:00、18:00 和 21:00。你可以单独开关或删除任务，增加定时问候，也可以用 **说一句** 立即显示一句话。

默认提醒覆盖喝水、久坐、护眼、休息和下班。每一项都能单独开关、编辑文案、设置定时或间隔、指定动作和展示时长；需要安静时可开启免打扰。设置会保存在本机的 Electron 用户数据目录中。

发布版启动后会检查 GitHub Releases，也可以在设置页手动检查、下载和重启安装。开发环境默认不会自动检查更新。

## 开发与发布

```bash
npm test
npm run test:renderer
npm run build:unpack
```

`npm test` 运行 Node 测试；`npm run test:renderer` 会启动真实的 Electron 渲染页，验证桌宠的几何尺寸、命中范围、备用渲染、点击、拖动和缩放行为。

从干净分支发布新版本：

```bash
./scripts/release-publish.sh 0.2.4
```

推送 `v*` 标签会触发发布工作流：运行测试、创建或更新 GitHub Release、构建 Windows x64 NSIS 安装包和 macOS zip，并上传安装包和更新清单。

## 隐私与项目来源

Our Pets 会把角色选择、窗口位置、问候和提醒配置保存在本机。它不会启动本地 HTTP API，也不会修改外部 Agent 的配置；检查更新时仅会访问 GitHub Releases。

本项目基于 [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet) 定制，使用 [MIT License](LICENSE)。
