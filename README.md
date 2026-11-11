# 雨中醒来 · Wake in the Rain

一款第一人称潜行单机小游戏（网页版，Three.js），可直接部署到 GitHub Pages，并在 iPhone 上“添加到主屏幕”后像 App 一样全屏游玩。

本仓库包含 **第一章《雨中醒来》**。完整剧本与五章结构见 [STORY.md](STORY.md)（含剧透）。

## 部署到 GitHub Pages（约 3 分钟）

1. 在 GitHub 新建一个仓库（例如 `raintown`），公开（Public）。
2. 把本文件夹里的**全部文件**上传到仓库根目录（网页上直接拖拽上传即可，注意 `.nojekyll` 也要上传）。
3. 进入仓库 **Settings → Pages**，Source 选 **Deploy from a branch**，Branch 选 `main`、目录选 `/ (root)`，保存。
4. 等 1–2 分钟，页面会给出地址：`https://你的用户名.github.io/raintown/`。

> 用 git 的话：`git init && git add . && git commit -m "chapter 1" && git branch -M main && git remote add origin https://github.com/你的用户名/raintown.git && git push -u origin main`

## 在 iPhone 上安装

1. 用 **Safari** 打开上面的地址（必须是 Safari）。
2. 点底部「分享」→「添加到主屏幕」。
3. 从桌面图标启动：全屏、横屏游玩；第一次加载后可离线运行（Service Worker 缓存）。
4. 建议戴耳机——所有声音（雨、雷、脚步、哨声、钟声）都是实时合成的。

## 操作

| | 触屏 | 键鼠 |
|---|---|---|
| 移动 | 左半屏拖动（推到边缘奔跑） | WASD，Shift 奔跑 |
| 视角 | 右半屏拖动 | 鼠标 |
| 开火 / 瞄准 | 右下大按钮 / 准星按钮 | 左键 / 右键 |
| 蹲伏 / 装填 | 按钮 | C / R |
| 交互 / 刀杀 | “查看”按钮（出现时） | E |
| 日志 / 暂停 | 右上角暂停按钮 | J / Esc |

## 本地运行

浏览器不允许直接双击打开（ES 模块需要 HTTP）。在本目录执行任一命令，然后打开 `http://localhost:8000`：

```
python3 -m http.server 8000
npx serve .
```

## 目录

```
index.html            页面与 UI
css/style.css         界面样式（含 iOS 安全区、横屏提示）
js/main.js            状态机、开场/结尾演出、HUD、存档
js/world.js           地形、小镇拼装、树林、雨、雾、闪电、碰撞与寻路
js/enemies.js         守卫：视野/听觉、起疑→调查→警报→搜索
js/player.js          第一人称移动、姿态、隐蔽度、单发步枪、刀杀
js/audio.js           全程序化音效（WebAudio）
js/story.js           剧情文本与章节表
assets/*.glb          压缩后的模型（来源见 CREDITS.md）
sw.js / manifest      PWA：离线缓存、主屏幕图标
```

## 更新版本

修改文件后，把 `sw.js` 第一行的 `raintown-v1` 改成 `raintown-v2`，否则已安装的手机会继续用旧缓存。

## 调试参数

- `?q=low` 强制流畅画质，`?q=high` 强制高画质
- `?dpr=1` 指定渲染分辨率倍率（手机发热时可用 `?dpr=1`）
