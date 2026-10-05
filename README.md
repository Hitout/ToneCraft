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

`wechat-miniprogram/` 下的源码、测试、配置文件和公开替代素材采用 Apache-2.0，具体授权范围和排除项见 [`LICENSE`](LICENSE) 与 [`LICENSE-SCOPE.md`](LICENSE-SCOPE.md)。ToneCraft 的原始品牌名称、Logo、应用图标、品牌视觉资产及 `docs/` 法律页面不在 Apache-2.0 授权范围内。

## 私有素材发布

公开仓库使用替代图标。正式发布小程序时，可以将原始素材放在仓库外的 `ToneCraftPrivateAssets/` 目录，然后运行：

```bash
./tools/prepare-miniprogram-release.sh
```

脚本会在仓库外生成 `ToneCraftMiniProgramRelease/`，将原始素材注入到相同路径中。请使用生成目录发布，不要把生成目录或其中的私有素材提交回本仓库。
