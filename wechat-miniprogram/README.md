# ToneCraft 微信小程序

ToneCraft 的微信小程序版本，包含节拍器与调音器。

## 使用

除了本地运行，也可以直接在微信中搜索“音匠节拍器”或“音匠调音器”使用。

## 页面预览

### 节拍器

![节拍器页面](screenshots/metronome.png)

### 调音器

![调音器页面](screenshots/tuner.png)

## 运行

1. 在当前目录执行 `npm install`。
2. 用微信开发者工具导入当前 `wechat-miniprogram` 目录。
3. 使用你有权限管理的 AppID。
4. 运行 `npm run typecheck` 和 `npm test` 做本地检查。

公开仓库不包含 `miniprogram/assets/icons/` 图标文件。启动前请在该路径准备你有权使用的完整图标资源；缺少图标时，相关页面无法正常显示。
