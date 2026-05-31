# 🎵 LyricVista

> Windows 桌面歌词悬浮窗 — 自动识别任意音乐 App 当前播放，逐行高亮滚动显示歌词。

## ✨ 特性

- **全 App 兼容** — 通过 Windows SMTC API 自动检测网易云、QQ音乐、Spotify 等任意播放器
- **逐行高亮滚动** — 基于播放时间轴精准同步，当前句放大高亮
- **高度可定制** — 字体、字号、颜色、透明度、背景模糊全部可调
- **无边框置顶** — 半透明悬浮窗始终置顶，不遮挡操作
- **系统托盘驻留** — 最小化到托盘，不占任务栏空间
- **自带后端缓存** — Express + SQLite 歌词缓存，同一首歌秒加载

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 33 |
| 前端 UI | React 19 + TypeScript + Vite 6 |
| 后端 | Express 4 + better-sqlite3 |
| 系统交互 | Windows SMTC (PowerShell) |
| 歌词数据源 | [LRCLIB](https://lrclib.net) |
| 打包 | electron-builder |

## 🏗 项目结构

```
LyricVista/
├── electron/              # Electron 主进程
│   ├── main.ts            # 窗口管理 / IPC / SMTC 轮询
│   ├── preload.ts         # 安全的 contextBridge 暴露
│   └── smtc.ps1           # PowerShell: 查询系统媒体信息
├── src/                   # React 渲染进程
│   ├── App.tsx            # 主组件：状态管理 / 歌词拉取
│   ├── components/
│   │   ├── LyricsWindow   # 歌词悬浮窗 + 滚动动画
│   │   └── SettingsPanel  # 外观设置面板
│   └── types.ts           # 共享类型定义
├── server/                # Express 后端
│   ├── index.ts           # REST API: /api/lyrics, /api/preferences
│   └── db.ts              # SQLite 初始化 + SQL 语句
├── resources/
│   └── icon.png           # 托盘图标
└── package.json
```

## 🚀 快速开始

### 环境要求

- Windows 10/11
- Node.js >= 18
- npm >= 9

### 安装 & 运行

```bash
# 安装依赖
npm install

# 开发模式（三进程并行：Vite + Electron + Express）
npm run dev

# 打包为便携版 exe
npm run package
```

开发模式下：
- 前端 Dev Server → `http://localhost:5173`
- 后端 API → `http://localhost:3456`
- 歌词窗口自动弹出，打开任意音乐 App 播歌即可看到效果

### 使用说明

1. 启动后歌词窗口会出现在屏幕右上角
2. 打开网易云/QQ音乐/Spotify 等任意音乐 App 开始播放
3. 歌词自动滚动显示，当前句高亮
4. 点击 ⚙ 进入设置面板，自定义外观
5. 点击 ─ 最小化到系统托盘
6. 右键托盘图标可显示/隐藏/退出

## 📡 API 设计

### GET /api/lyrics

```
GET /api/lyrics?title=Blinding+Lights&artist=The+Weeknd
```

响应：
```json
{
  "lyrics": "Yeah\n\nI've been tryna call...",
  "syncedLyrics": "[00:12.34]Line 1\n[00:15.67]Line 2...",
  "cached": false
}
```

- 首次请求 → 从 LRCLIB 获取 → 缓存到 SQLite
- 重复请求 → 直接返回缓存 (`cached: true`)

### GET/PUT /api/preferences

存储和读取用户自定义样式配置。

## 🧪 验收清单

- [x] 打开网易云/QQ音乐/Spotify 任意一个放歌 → 歌词窗自动弹出
- [x] 播放进度变化时，歌词行自动滚动并高亮当前句
- [x] 托盘图标常驻，右键可切换显示
- [x] 设置面板改字体/颜色 → 歌词窗实时生效
- [x] 同一首歌第二次播放 → 歌词从本地缓存加载

## 🎤 面试话术

- "Electron 实现 Windows 桌面应用，掌握跨前端技术栈的桌面开发能力"
- "SMTC 系统级 API 集成，理解 Windows 操作系统层面的媒体控制机制"
- "全栈架构：React 前端 + Express 后端 + SQLite，接口设计清晰，有缓存策略"
- "自驱动项目：从真实痛点出发，而非照搬教程项目"

## 📄 License

MIT
