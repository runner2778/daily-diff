#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把整个应用打包成一个 HTML 文件（样式、脚本、当天内容全部内嵌）。

    python3 build.py

生成：每日信息差.html
可以直接双击打开、发微信、存手机，不需要任何服务，断网也能看。
内容是打包那一刻的快照。
"""

import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)


def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


def safe_json(obj):
    # 防止内容里的 </script> 提前结束标签
    return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")


def main():
    html = read("index.html")
    css = read("style.css")
    data_js = read("data.js")
    app_js = read("app.js")

    try:
        feed = json.loads(read("feed.json"))
    except Exception:
        feed = {"items": [], "count": 0}

    try:
        notes = json.loads(read("ai-notes.json")).get("notes", {})
    except Exception:
        notes = {}

    try:
        lib = json.loads(read("library.json"))
    except Exception:
        lib = {"items": []}

    # 图标内嵌（没有也能用）
    icon_tag = ""
    try:
        with open("icon-192.png", "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        icon_tag = '<link rel="apple-touch-icon" href="data:image/png;base64,%s">' % b64
    except Exception:
        pass

    html = html.replace('<link rel="stylesheet" href="style.css">',
                        "<style>\n%s\n</style>" % css)
    html = html.replace('<link rel="manifest" href="manifest.json">', "")
    html = html.replace('<link rel="apple-touch-icon" href="icon-192.png">', icon_tag)
    html = html.replace('<script src="data.js"></script>',
                        "<script>\n%s\n</script>" % data_js)
    html = html.replace('<script src="app.js"></script>',
                        "<script>window.__FEED__=%s;window.__NOTES__=%s;window.__LIB__=%s;</script>\n<script>\n%s\n</script>"
                        % (safe_json(feed), safe_json(notes), safe_json(lib), app_js))

    # 输出到 dist/，只放前端文件——脚本、密钥、二维码都不进去
    dist = os.path.join(HERE, "dist")
    if not os.path.isdir(dist):
        os.makedirs(dist)

    for name in ("index.html", "style.css", "app.js", "data.js", "feed.json",
                 "ai-notes.json", "library.json", "manifest.json", "sw.js", "icon-192.png", "icon-512.png"):
        if os.path.exists(name):
            with open(name, "rb") as src, open(os.path.join(dist, name), "wb") as dst:
                dst.write(src.read())

    out = os.path.join(dist, "每日信息差.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(out) / 1024.0
    print("已生成 dist/（单文件 %.0f KB，含 %d 条内容）" % (size, len(feed.get("items", []))))
    print("发布时只发 dist/ 这个目录，脚本和密钥都在上层，不会外泄。")
    return out


if __name__ == "__main__":
    main()
