#!/usr/bin/env python3
"""从应用清单生成中英双语官网和 Cloudflare 静态资源包。"""

import html
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
ORIGIN = "https://gxyan.site"
EMAIL = "gxyancn@gmail.com"
ARROW = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'
EXTERNAL = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>'
PLAY = '<svg class="play-icon" viewBox="0 0 20 23" aria-hidden="true"><path d="m1 1 18 10.5L1 22Z"/></svg>'

COPY = {
    "zh": {
        "lang": "zh-CN", "home": "/", "other": "EN", "other_home": "/en/",
        "title": "Gavyn · 小而专注的应用", "description": "探索 Gavyn 的应用作品。小而专注的工具，让日常多一点顺手。查看 ToneCraft 音匠及后续应用，获取下载、隐私政策与支持。",
        "skip": "跳到主要内容", "apps": "应用", "about": "关于", "contact": "联系",
        "eyebrow": "GAVYN · APPS FOR EVERYDAY", "headline": "简单的工具，<br><span>认真地做好。</span>",
        "intro": "这里是 Gavyn 的应用作品集。<br>从日常的一点需要出发，做小而专注、用起来顺手的应用。",
        "explore": "探索应用", "say_hello": "打个招呼", "bench_label": "AN EVOLVING COLLECTION", "next_icon": "更多可能", "bench_caption": "一点想法，一件作品。",
        "apps_label": "THE COLLECTION", "apps_title": "从一个好用的 App 开始", "apps_note": "每个应用，解决一点小事。",
        "privacy": "隐私政策", "download": "在 Google Play 下载", "next_index": "WHAT COMES NEXT", "next_title": "更多好用的想法，<br>陆续见。", "next_description": "这里会持续收录 Gavyn 的新应用。<br>下次来，或许就有新的发现。", "next_bottom": "为下一件作品，留个位置。",
        "about_label": "A FEW THINGS I CARE ABOUT", "about_title": "做应用，也做一点取舍。",
        "principles": [("简单上手", "减少多余步骤，让工具在需要的时候，随手就能用。"), ("专注体验", "让每个功能都有清晰的目的，也有顺手的交互。"), ("认真打磨", "关注真实的使用感受，让小细节也值得被照顾。")],
        "contact_label": "LET’S TALK", "contact_title": "有想法，聊聊。", "contact_description": "使用中遇到问题，或有一个值得做出来的想法？<br>欢迎给 Gavyn 写封邮件。",
        "footer_privacy": "隐私与支持", "footer_play": "Google Play", "footer_sign": "简单一点，刚刚好。",
        "policy_title": "隐私与支持", "policy_intro": "在这里了解官网的信息处理方式，并找到各应用的隐私政策与支持入口。",
        "policy_site_title": "关于本官网", "policy_site_body": "本官网用于展示 Gavyn 的应用作品。网站不提供账号注册或信息提交表单，未接入广告、访问统计或营销追踪脚本。网站本身的信息处理方式与各 App 的信息处理方式分开说明。",
        "policy_host_title": "网站托管", "policy_host_body": "官网通过 Cloudflare 提供访问服务。为提供网络连接、处理请求和保障安全，Cloudflare 可能处理 IP 地址、请求信息和必要的安全日志，具体方式以其隐私政策为准。",
        "policy_apps_title": "应用隐私政策", "policy_apps_body": "每个应用有各自的功能和数据处理方式。使用前，请阅读对应应用的隐私政策。",
        "policy_contact_title": "联系与支持", "policy_contact_body": "如需应用支持，或对隐私与数据处理有疑问，请通过以下邮箱联系：",
        "policy_date": "最后更新：2026 年 10 月 21 日", "cloudflare_privacy": "Cloudflare 隐私政策", "read_policy": "阅读 Android 隐私政策",
    },
    "en": {
        "lang": "en", "home": "/en/", "other": "中文", "other_home": "/",
        "title": "Gavyn · Small apps, thoughtfully made", "description": "Explore apps by Gavyn. Focused tools for everyday moments. Find ToneCraft, future releases, download links, privacy policies, and support.",
        "skip": "Skip to content", "apps": "Apps", "about": "About", "contact": "Contact",
        "eyebrow": "GAVYN · APPS FOR EVERYDAY", "headline": "Small apps.<br><span>Thoughtfully made.</span>",
        "intro": "A growing collection of apps by Gavyn.<br>Starting with everyday needs. Keeping things focused, useful, and a pleasure to use.",
        "explore": "Explore the apps", "say_hello": "Say hello", "bench_label": "AN EVOLVING COLLECTION", "next_icon": "WHAT’S NEXT", "bench_caption": "One idea. One thoughtful app.",
        "apps_label": "THE COLLECTION", "apps_title": "A little useful goes a long way.", "apps_note": "Small tools for everyday moments.",
        "privacy": "Privacy policy", "download": "Get it on Google Play", "next_index": "WHAT COMES NEXT", "next_title": "More little things.<br>More possibilities.", "next_description": "New apps will find a home here.<br>Come back for the next small discovery.", "next_bottom": "A little room for what’s next.",
        "about_label": "A FEW THINGS I CARE ABOUT", "about_title": "Less friction. More thought.",
        "principles": [("Easy to get into", "Fewer unnecessary steps. A tool that feels ready when you need it."), ("Focused by design", "A clear purpose for every feature, and a thoughtful way to use it."), ("Care in the details", "Paying attention to everyday use, including the little things.")],
        "contact_label": "LET’S TALK", "contact_title": "Have a thought? Say hello.", "contact_description": "A question about an app, or an idea worth exploring?<br>Gavyn is an email away.",
        "footer_privacy": "Privacy & support", "footer_play": "Google Play", "footer_sign": "Keep it simple. Make it useful.",
        "policy_title": "Privacy & support", "policy_intro": "Learn how this website handles information, and find privacy policies and support for each app.",
        "policy_site_title": "About this website", "policy_site_body": "This website showcases apps by Gavyn. It has no account registration or submission forms, and does not include advertising, analytics, or marketing tracking scripts. The website’s information handling is described separately from the practices of individual apps.",
        "policy_host_title": "Website hosting", "policy_host_body": "This website is delivered through Cloudflare. To provide connectivity, process requests, and maintain security, Cloudflare may process IP addresses, request information, and necessary security logs under its own privacy policy.",
        "policy_apps_title": "App privacy policies", "policy_apps_body": "Each app has its own features and information handling practices. Please read the privacy policy for the app you use.",
        "policy_contact_title": "Contact & support", "policy_contact_body": "For app support or questions about privacy and data handling, contact:",
        "policy_date": "Last updated: October 21, 2026", "cloudflare_privacy": "Cloudflare privacy policy", "read_policy": "Read the Android privacy policy",
    },
}


def escape(value):
    """应用清单会进入 HTML 文本和属性，统一转义以保证后续新增内容安全。"""
    return html.escape(str(value), quote=True)


def app_card(app, language, copy):
    localized = app[language]
    privacy = localized.get("privacy", app["privacy"])
    features = "".join(f"<li>{escape(feature)}</li>" for feature in localized["features"])
    return f'''<article class="app-card" id="{escape(app['id'])}">
      <div class="app-top"><img class="app-icon" src="/assets/{escape(app['icon'])}" alt="{escape(app['name'])}" width="72" height="72" loading="lazy"><span class="platform"><span class="dot" aria-hidden="true"></span>ANDROID</span></div>
      <div class="app-title-row"><h3>{escape(app['name'])}</h3><span class="app-category">{escape(localized['category'])}</span></div>
      <p class="app-subtitle">{escape(localized['subtitle'])}</p><p class="app-description">{escape(localized['description'])}</p>
      <ul class="feature-tags">{features}</ul>
      <div class="app-links"><a class="download-link" href="{escape(app['download'])}">{PLAY}{escape(copy['download'])}{EXTERNAL}</a><a class="privacy-link" href="{escape(privacy)}">{escape(copy['privacy'])}</a></div>
    </article>'''


def layout(copy, language, content, privacy=False):
    """两种语言共享导航结构，子页面的锚点始终返回对应语言首页。"""
    home = copy["home"]
    path = home + ("privacy/" if privacy else "")
    other = copy["other_home"] + ("privacy/" if privacy else "")
    title = (copy["policy_title"] + " · Gavyn") if privacy else copy["title"]
    return f'''<!doctype html>
<html lang="{copy['lang']}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{escape(copy['description'])}"><meta name="theme-color" content="#f7f7f0">
  <title>{escape(title)}</title><link rel="canonical" href="{ORIGIN}{path}">
  <link rel="alternate" hreflang="zh-CN" href="{ORIGIN}{'/privacy/' if privacy else '/'}"><link rel="alternate" hreflang="en" href="{ORIGIN}{'/en/privacy/' if privacy else '/en/'}">
  <meta property="og:title" content="{escape(title)}"><meta property="og:description" content="{escape(copy['description'])}"><meta property="og:type" content="website"><meta property="og:url" content="{ORIGIN}{path}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">{copy['skip']}</a>
  <div class="wrap"><header class="site-header"><a class="brand" href="{home}" aria-label="Gavyn"><span class="brand-mark" aria-hidden="true">g</span><span>Gavyn<span aria-hidden="true">.</span></span></a><nav class="nav" aria-label="{'主导航' if language == 'zh' else 'Main navigation'}"><a href="{home}#apps">{copy['apps']}</a><a class="nav-about" href="{home}#about">{copy['about']}</a><a href="{home}#contact">{copy['contact']}</a><a class="language" href="{other}" lang="{'en' if language == 'zh' else 'zh-CN'}">{copy['other']}</a></nav></header>
  {content}
  <footer class="footer"><span>© 2026 Gavyn</span><div class="footer-links"><a href="{home}privacy/">{copy['footer_privacy']}</a><a href="https://play.google.com/store/apps/developer?id=Gavyn">{copy['footer_play']}{' ↗'}</a></div><span class="footer-sign"><span class="dot" aria-hidden="true"></span>{copy['footer_sign']}</span></footer></div>
</body>
</html>
'''


def homepage(apps, language, copy):
    cards = "".join(app_card(app, language, copy) for app in apps)
    principles = "".join(f'<article class="principle"><span class="principle-index">0{index}</span><h3>{escape(title)}</h3><p>{escape(body)}</p></article>' for index, (title, body) in enumerate(copy["principles"], start=1))
    return f'''<main id="main">
    <section class="hero" aria-labelledby="hero-title"><div><div class="eyebrow"><span class="dot" aria-hidden="true"></span>{copy['eyebrow']}</div><h1 id="hero-title">{copy['headline']}</h1><p class="intro">{copy['intro']}</p><div class="hero-actions"><a class="button button-primary" href="#apps">{copy['explore']}{ARROW}</a><a class="text-link" href="#contact">{copy['say_hello']}{EXTERNAL}</a></div></div>
      <div class="workbench"><span class="bench-label">{copy['bench_label']}</span><span class="bench-letter" aria-hidden="true">g.</span><a class="app-token" href="#tonecraft" aria-label="ToneCraft"><img src="/assets/tonecraft.png" alt="ToneCraft" width="100" height="100"></a><div class="future-token" aria-hidden="true"><span class="plus">+</span><small>{copy['next_icon']}</small></div><span class="bench-caption"><span class="dot" aria-hidden="true"></span>{copy['bench_caption']}</span></div>
    </section>
    <section class="apps-section" id="apps" aria-labelledby="apps-title"><div class="section-heading"><div><span class="section-label">{copy['apps_label']}</span><h2 id="apps-title">{copy['apps_title']}</h2></div><p class="section-note">{copy['apps_note']}</p></div><div class="app-grid">{cards}<aside class="next-app"><span class="next-index">{copy['next_index']}</span><div class="next-art" aria-hidden="true">+</div><h3>{copy['next_title']}</h3><p>{copy['next_description']}</p><span class="next-bottom"><span class="dot" aria-hidden="true"></span>{copy['next_bottom']}</span></aside></div></section>
    <section class="philosophy" id="about" aria-labelledby="about-title"><div class="section-heading"><div><span class="section-label">{copy['about_label']}</span><h2 id="about-title">{copy['about_title']}</h2></div></div><div class="principles">{principles}</div></section>
    <section class="contact" id="contact" aria-labelledby="contact-title"><div><span class="section-label">{copy['contact_label']}</span><h2 id="contact-title">{copy['contact_title']}</h2><p>{copy['contact_description']}</p></div><a class="contact-link" href="mailto:{EMAIL}">{EMAIL}{EXTERNAL}</a></section>
  </main>'''


def privacy_page(apps, language, copy):
    policies = "".join(f'<div class="policy-app"><img src="/assets/{escape(app["icon"])}" alt="" width="44" height="44"><div><strong>{escape(app["name"])}</strong><br><a href="{escape(app[language].get("privacy", app["privacy"]))}">{copy["read_policy"]} ↗</a></div></div>' for app in apps)
    return f'''<main class="privacy-page" id="main"><span class="section-label">PRIVACY & SUPPORT</span><h1>{copy['policy_title']}</h1><p class="lead">{copy['policy_intro']}</p>
      <section class="policy-section"><h2>{copy['policy_site_title']}</h2><p>{copy['policy_site_body']}</p></section>
      <section class="policy-section"><h2>{copy['policy_host_title']}</h2><p>{copy['policy_host_body']}</p><p><a href="https://www.cloudflare.com/privacypolicy/">{copy['cloudflare_privacy']} ↗</a></p></section>
      <section class="policy-section"><h2>{copy['policy_apps_title']}</h2><p>{copy['policy_apps_body']}</p>{policies}</section>
      <section class="policy-section"><h2>{copy['policy_contact_title']}</h2><p>{copy['policy_contact_body']}<br><a href="mailto:{EMAIL}">{EMAIL}</a></p></section><p class="policy-date">{copy['policy_date']}</p></main>'''


def build():
    # 1. 校验应用清单，避免把无效链接或重复应用发布到官网。
    apps = json.loads((ROOT / "apps.json").read_text(encoding="utf-8"))
    ids = set()
    for app in apps:
        if app["id"] in ids:
            raise ValueError("应用 id 不能重复")
        ids.add(app["id"])
        if not app["download"].startswith("https://") or not app["privacy"].startswith("https://"):
            raise ValueError("应用下载和隐私政策必须使用 HTTPS")
        if not (ROOT / "assets" / app["icon"]).is_file():
            raise ValueError("找不到应用图标")

    # 2. 完整重建静态目录，避免已移除的资源残留在部署包中。
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(ROOT / "assets", DIST / "assets")
    # 审核演示使用独立入口，保留视频及播放页，避免后续官网部署丢失声明链接。
    review = ROOT / "review"
    if review.is_dir():
        shutil.copytree(review, DIST / "review")
    for filename in ("styles.css", "favicon.svg"):
        shutil.copyfile(ROOT / filename, DIST / filename)
    for language, copy in COPY.items():
        target = DIST / ("en" if language == "en" else "")
        target.mkdir(exist_ok=True)
        (target / "index.html").write_text(layout(copy, language, homepage(apps, language, copy)), encoding="utf-8")
        (target / "privacy").mkdir()
        (target / "privacy" / "index.html").write_text(layout(copy, language, privacy_page(apps, language, copy), privacy=True), encoding="utf-8")

    # 3. 广告验证文本保持固定，不能与页面模板或富文本内容混合。
    (DIST / "app-ads.txt").write_text("google.com, pub-2388398816861308, DIRECT, f08c47fec0942fa0\n", encoding="utf-8")
    robots = "\n\n".join(
        f"User-agent: {agent}\nDisallow:"
        for agent in ("Google-adstxt", "Mediapartners-Google", "Googlebot")
    )
    (DIST / "robots.txt").write_text(robots + f"\n\nUser-agent: *\nAllow: /\n\nSitemap: {ORIGIN}/sitemap.xml\n", encoding="utf-8")
    sitemap_urls = [ORIGIN + path for path in ("/", "/en/", "/privacy/", "/en/privacy/")]
    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{url}</loc></url>" for url in sitemap_urls) + "</urlset>\n", encoding="utf-8")
    (DIST / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/app-ads.txt\n  Content-Type: text/plain; charset=utf-8\n  Cache-Control: public, max-age=300\n/review/*\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8")

    # 4. ZIP 根目录对应网站根目录，Cloudflare 可直接解包发布。
    archive = ROOT / "gavyn-site.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
        for path in sorted(DIST.rglob("*")):
            if path.is_file():
                package.write(path, path.relative_to(DIST))
    print(f"已生成 {len(apps)} 个应用、4 个双语页面：{DIST}")
    print(f"部署文件：{archive}")


if __name__ == "__main__":
    build()
