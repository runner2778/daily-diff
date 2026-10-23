#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日信息差 · 本地服务
--------------------------------------------------
一条命令搞定「自动抓取 + 打开页面 + 定时更新」：

    python3 serve.py

然后浏览器访问  http://localhost:8788

它会：
  1. 启动时如果 feed.json 超过 3 小时就抓一次；
  2. 之后每 10 分钟检查一次，过期就自动重抓；
  3. 页面上的「刷新」按钮会调用 /api/refresh 立即更新。

端口可以用环境变量改：DD_PORT=9000 python3 serve.py
"""

import json
import os
import sys
import time
import threading
import webbrowser
import http.server
import socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

import collector  # noqa: E402

PORT = int(os.environ.get("DD_PORT", "8788"))
MAX_AGE = 3 * 3600          # 内容超过 3 小时就重抓
CHECK_EVERY = 600           # 每 10 分钟检查一次


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/feed"):
            try:
                with open(os.path.join(HERE, "feed.json"), "r", encoding="utf-8") as f:
                    return self._send_json(json.load(f))
            except Exception:
                return self._send_json({"items": [], "count": 0})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/refresh"):
            try:
                feed = collector.collect(limit=60, quiet=True)
                return self._send_json(feed)
            except Exception as ex:
                return self._send_json({"error": str(ex)}, 500)
        self.send_error(404)


def lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def make_qr(url):
    """给手机扫码用；没装 qrcode 库就跳过"""
    try:
        import qrcode
        img = qrcode.make(url)
        img.save(os.path.join(HERE, "qr.png"))
        return True
    except Exception:
        return False


def write_local(url):
    try:
        with open(os.path.join(HERE, "local.json"), "w", encoding="utf-8") as f:
            json.dump({"url": url}, f, ensure_ascii=False)
    except Exception:
        pass


def stale():
    p = os.path.join(HERE, "feed.json")
    return (not os.path.exists(p)) or (time.time() - os.path.getmtime(p) > MAX_AGE)


def scheduler():
    while True:
        try:
            if stale():
                print("[%s] 自动抓取中…" % time.strftime("%H:%M"))
                f = collector.collect(limit=60, quiet=True)
                print("[%s] 已更新：%d 条 / %d 个源正常"
                      % (time.strftime("%H:%M"), f["count"], f["sources_ok"]))
        except Exception as ex:
            print("自动抓取出错：", ex)
        time.sleep(CHECK_EVERY)


def main():
    print("=" * 46)
    print(" 每日信息差 · 本地服务")
    print(" 电脑：http://localhost:%d" % PORT)
    ip = lan_ip()
    phone = "http://%s:%d" % (ip, PORT)
    if ip != "127.0.0.1":
        print(" 手机：%s  （同一 WiFi 下扫码或输入）" % phone)
        write_local(phone)
        make_qr(phone)
    print(" 抓取间隔：内容超过 3 小时自动更新")
    print(" AI 总结：%s" % ("已启用 · " + os.environ.get("DD_LLM_MODEL", "")
                           if os.environ.get("DD_LLM_KEY") else "未配置（英文源保留原文）"))
    print("=" * 46)

    if stale():
        print("首次启动，先抓一次…")
        try:
            f = collector.collect(limit=60, quiet=True)
            print("已抓取 %d 条（%d 个源正常）" % (f["count"], f["sources_ok"]))
        except Exception as ex:
            print("抓取失败，先用已有的 feed.json：", ex)

    threading.Thread(target=scheduler, daemon=True).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        # 有图形界面时才自动开浏览器（服务器/无桌面环境会跳过）
        if os.environ.get("DISPLAY") or sys.platform in ("darwin", "win32"):
            try:
                webbrowser.open("http://localhost:%d" % PORT)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()
