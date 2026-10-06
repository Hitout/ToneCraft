# ToneCraft

ToneCraft 微信小程序源码及配套公开页面。

## 仓库结构

- [`wechat-miniprogram/`](wechat-miniprogram/)：微信小程序源码、测试和开发配置。
- [`docs/`](docs/)：GitHub Pages 发布的公开页面和法律页面。

## 微信小程序

在微信开发者工具中导入 [`wechat-miniprogram/`](wechat-miniprogram/) 目录。进入该目录后可以运行：

```bash
npm install
npm run typecheck
npm test
```

Fork 本仓库后，请在 `wechat-miniprogram/project.config.json` 中替换为你自己的 AppID。AppID 不是 AppSecret，任何发布或开发权限仍由微信公众平台账号控制。

## 公开页面

- [隐私政策](https://hitout.github.io/ToneCraft/privacy-policy/)
- [Privacy Policy](https://hitout.github.io/ToneCraft/privacy-policy/en/)
- [用户协议](https://hitout.github.io/ToneCraft/user-agreement/)
- [User Agreement](https://hitout.github.io/ToneCraft/user-agreement/en/)

## 许可证

ToneCraft 微信小程序源码项目采用 Apache-2.0。仓库中的微信小程序源码、测试和配置文件在授权范围内；`wechat-miniprogram/miniprogram/assets/icons/` 图标目录和 `wechat-miniprogram/miniprogram/assets/images/` 中未明确授权的视觉素材不包含在公开授权内容中，ToneCraft 品牌与商标以及 `docs/` 法律页面也不在 Apache-2.0 授权范围内。代码仍按原路径引用图标资源，运行前请按 [`wechat-miniprogram/README.md`](wechat-miniprogram/README.md) 准备本地图标目录。具体范围见 [`LICENSE`](LICENSE) 与 [`LICENSE-SCOPE.md`](LICENSE-SCOPE.md)。
