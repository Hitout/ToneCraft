# Gavyn 开发者官网

面向多个应用的中英双语静态官网，部署域名为 `https://gxyan.site`。

## 修改应用

编辑 `apps.json`。新增应用时复制一个条目，设置唯一 `id`，填写两种语言的介绍、下载地址和隐私政策地址，并将图标放入 `assets/`。

## 构建与预览

```sh
python3 build.py
python3 -m http.server 4173 --directory dist --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:4173`。英文首页位于 `/en/`，隐私与支持页面位于 `/privacy/` 和 `/en/privacy/`。

## 发布

构建产生 `dist/` 和 `gavyn-site.zip`。在 Cloudflare 的 `tonecraft-app-ads` Worker 中选择“新部署”，上传 ZIP，核对所有资源后发布。

每次部署都需要保留根目录的 `app-ads.txt`；`build.py` 已包含当前 AdMob 发布商信息。网站没有账号、表单、访问统计或第三方前端依赖。官网的隐私说明与各应用的隐私政策分开维护。

应用图标沿用现有 ToneCraft 品牌资产，其使用范围遵循仓库的 `LICENSE-SCOPE.md`。

## Google Play 审核演示

`review/` 保存前台服务声明的 Android 演示视频和独立播放页，地址为 `https://gxyan.site/review/`。构建时一并复制，后续更新官网应保留该目录，确保审核链接持续有效。播放页和视频无需登录，并通过 `noindex` 避免进入搜索结果。
