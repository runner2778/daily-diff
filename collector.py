#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日信息差 · 采集器
--------------------------------------------------
用法：
    python3 collector.py                # 抓取一次，写入 feed.json
    python3 collector.py --limit 40     # 只保留 40 条

可选：接入大模型，把英文新闻翻译成中文、并生成「小学生版」解读。
在环境变量里配置（任何 OpenAI 兼容接口都行，DeepSeek / Kimi / 通义 / 智谱 均可）：

    export DD_LLM_KEY=sk-xxxx
    export DD_LLM_BASE=https://api.deepseek.com/v1
    export DD_LLM_MODEL=deepseek-chat

不配置也能跑，只是英文源保留原文、摘要为自动截取。
"""

import json
import os
import re
import sys
import html
import time
import socket
import hashlib
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
FEED_PATH = os.path.join(HERE, "feed.json")
SOURCES_PATH = os.path.join(HERE, "sources.json")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/121.0 Safari/537.36")
TIMEOUT = 18
PER_SOURCE = 4
PER_REGION = 8
PER_REGION_CN = 32

# 低价值 / 不适合的内容：金融推广稿、时政名单、讣告等
BLOCK = re.compile(
    r"(ETF|基金|涨停|跌停|涨幅|跌幅|指数|净值|分红|认购|中签|券商|研报|目标价"
    r"|党委|委员会|书记|省长|市长|议员|选举|候选人|投票|票数|民调"
    r"|讣告|去世|逝世|葬礼|追悼|彩票|星座|运势"
    r"|candidat|elei[çc]|election|voter|polling|obituary|dies at|passed away|funeral)", re.I)
CST = timezone(timedelta(hours=8))


# ---------------------------------------------------------------- 抓取
def fetch(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
    return raw


def clean(s):
    if not s:
        return ""
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def localname(tag):
    return tag.split("}")[-1].lower()


def parse_feed(raw, base_url):
    """兼容 RSS 2.0 / Atom / RDF，返回 [{title, summary, link, published}]"""
    try:
        root = ET.fromstring(raw)
    except Exception:
        # 有些源头部有 BOM 或声明错误，粗暴剪掉再试
        try:
            txt = raw.decode("utf-8", "ignore")
            txt = txt[txt.find("<"):]
            root = ET.fromstring(txt)
        except Exception:
            return []

    out = []
    entries = [e for e in root.iter() if localname(e.tag) in ("item", "entry")]

    for e in entries:
        title = summary = link = published = ""
        for ch in e:
            n = localname(ch.tag)
            if n == "title":
                title = clean(ch.text or "".join(ch.itertext()))
            elif n in ("description", "summary", "encoded", "content"):
                if not summary:
                    summary = clean("".join(ch.itertext()))
            elif n == "link":
                href = ch.get("href")
                if href and (not ch.get("rel") or ch.get("rel") == "alternate"):
                    link = href
                elif ch.text and ch.text.strip().startswith("http"):
                    link = ch.text.strip()
            elif n in ("pubdate", "published", "updated", "date"):
                if not published:
                    published = (ch.text or "").strip()

        # RDF 里 link 可能重复出现两次，保留第一个绝对地址
        if not link:
            for ch in e:
                if localname(ch.tag) == "link" and (ch.text or "").strip().startswith("http"):
                    link = ch.text.strip()
                    break

        if not title or len(title) < 6:
            continue
        out.append({
            "title": title,
            "summary": summary[:600],
            "link": link,
            "published": published,
        })
        if len(out) >= PER_SOURCE:
            break
    return out


def parse_time(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def grab(src):
    try:
        raw = fetch(src["url"])
        items = parse_feed(raw, src["url"])
        for it in items:
            it["source"] = src["name"]
            it["region"] = src.get("region", "其他")
            it["lang"] = src.get("lang", "zh")
            it["cat"] = src.get("cat", "综合")
            it["weight"] = src.get("weight", 1)
        return items
    except Exception as ex:
        return {"__error__": "%s: %s" % (src["name"], type(ex).__name__)}


# ---------------------------------------------------------------- 处理
def norm_title(t):
    t = re.sub(r"[^\w\u4e00-\u9fa5]+", "", t.lower())
    return t


def jaccard(a, b):
    A, B = set(a), set(b)
    if not A or not B:
        return 0
    return len(A & B) / len(A | B)


def dedupe(items):
    kept = []
    for it in items:
        nt = norm_title(it["title"])
        grams = [nt[i:i + 2] for i in range(max(1, len(nt) - 1))]
        dup = False
        for k in kept:
            if jaccard(grams, k["_grams"]) > 0.62:
                dup = True
                break
        if not dup:
            it["_grams"] = grams
            kept.append(it)
    for k in kept:
        k.pop("_grams", None)
    return kept



# 有信息量的标题特征 vs 产品发布稿特征
GOOD = re.compile(r"(为什么|如何|背后|意味着|趋势|研究|报告|数据显示|调查|首次|突破|警告|风险|成本|涨价|失业|崛起|崩塌|博弈|真相|逻辑|反思|困境|隐忧)")
BAD = re.compile(r"(发布|开售|预售|上架|开卖|官宣|亮相|曝光|图赏|图集|上手|开箱|联名|限定|促销|优惠|新品|发布会|预约)")


def value_score(it):
    s = it["weight"] * 2.0
    t = it["title"]
    if GOOD.search(t):
        s += 4
    if BAD.search(t):
        s -= 4
    if len(it.get("summary", "")) > 90:
        s += 2
    if len(t) < 12:
        s -= 3
    dt = it.get("_dt")
    if dt:
        hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
        s -= min(hours, 72) * 0.12
    return s


def item_id(it):
    return hashlib.md5((it["title"] + it["source"]).encode("utf-8")).hexdigest()[:10]


# ---------------------------------------------------------------- 大模型
def llm_available():
    return bool(os.environ.get("DD_LLM_KEY"))


def llm_generate(items, batch=12):
    """让模型把新闻变成「中文 + 说人话 + 信息差在哪」"""
    key = os.environ.get("DD_LLM_KEY")
    base = os.environ.get("DD_LLM_BASE", "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("DD_LLM_MODEL", "gpt-4o-mini")
    if not key:
        return items

    out = []
    for i in range(0, len(items), batch):
        chunk = items[i:i + batch]
        payload = [{"i": j, "source": x["source"], "title": x["title"],
                    "summary": x["summary"][:300]} for j, x in enumerate(chunk)]
        prompt = (
            "你是给普通人讲新闻的编辑。下面是一批新闻，请逐条输出 JSON 数组，不要任何多余文字。\n"
            "每条格式：{\"i\":序号,"
            "\"title_zh\":\"中文标题，32字内。英文内容翻成中文，但要保留原标题的钩子（数字、反差、疑问）；"
            "中文内容保留原标题，只去掉「丨xxx」「-xxx」这类栏目后缀和站点名，不要改写成通稿式的平淡标题\","
            "\"brief\":\"两句话讲清楚事实，必须带上关键数字或主体，70字内\","
            "\"kid\":\"用小学生能懂的具体场景或比喻解释这件事，要有画面感和数字对比；禁止「就像给XX装上大脑」这类空泛比喻，90字内\","
            "\"why\":\"这件事对普通人的具体影响，或者它暴露了什么趋势；不要写「未来可期」「值得关注」这类空话，70字内\","
            "\"cat\":\"从 政治/经济/科技/社会/商业/生活 中选一个\"}\n"
            "要求：不评论立场，只解释；输出必须是合法 JSON。\n\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        body = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": "你是一个严谨的新闻编辑，只输出 JSON。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
        }).encode("utf-8")

        req = urllib.request.Request(base + "/chat/completions", data=body, headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        })
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"].strip()
            text = re.sub(r"^```(json)?|```$", "", text, flags=re.M).strip()
            s, e = text.find("["), text.rfind("]")
            rows = json.loads(text[s:e + 1])
            by_i = {r["i"]: r for r in rows if isinstance(r, dict) and "i" in r}
            for j, x in enumerate(chunk):
                r = by_i.get(j)
                if r:
                    x["title_zh"] = r.get("title_zh") or x["title"]
                    x["brief"] = r.get("brief", "")
                    x["kid"] = r.get("kid", "")
                    x["why"] = r.get("why", "")
                    x["cat"] = r.get("cat", x["cat"])
                out.append(x)
            print("  · 模型总结完成 %d/%d" % (min(i + batch, len(items)), len(items)))
        except Exception as ex:
            print("  ! 模型调用失败（%s），这批保留原文" % type(ex).__name__)
            out.extend(chunk)
    return out


# ---------------------------------------------------------------- 主流程
def load_sources():
    with open(SOURCES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def collect(limit=60, use_llm=True, quiet=False):
    sources = load_sources()
    results, errors = [], []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(grab, s): s for s in sources}
        for fut in as_completed(futs):
            r = fut.result()
            if isinstance(r, dict) and "__error__" in r:
                errors.append(r["__error__"])
            else:
                results.extend(r)

    if not quiet:
        print("  抓到 %d 条 · 失败 %d 个源" % (len(results), len(errors)))

    now = datetime.now(timezone.utc)
    seen_links = set()
    items = []
    for it in results:
        it["published"] = it.get("published") or ""
        dt = parse_time(it["published"])
        it["_dt"] = dt
        # 太老的不要（超过 4 天）
        if dt and (now - dt).days > 4:
            continue
        lk = (it.get("link") or "").split("?")[0]
        if lk and lk in seen_links:
            continue
        if lk:
            seen_links.add(lk)
        it["id"] = item_id(it)
        items.append(it)

    # 过滤低价值内容
    before = len(items)
    items = [x for x in items if not BLOCK.search(x["title"])]
    if not quiet and before != len(items):
        print("  过滤掉 %d 条低价值内容" % (before - len(items)))

    # 中文优先；同语言内按「信息量」排序，而不是纯时间
    for x in items:
        x["_score"] = value_score(x)
    items.sort(key=lambda x: (0 if x["lang"] == "zh" else 1, -x["_score"]))
    items = dedupe(items)

    # 每个地区、每个源都设上限，避免某个国家刷屏
    picked, per_region, per_source = [], {}, {}
    for it in items:
        cap = PER_REGION_CN if it["lang"] == "zh" else PER_REGION
        if per_region.get(it["region"], 0) >= cap:
            continue
        if per_source.get(it["source"], 0) >= 5:
            continue
        picked.append(it)
        per_region[it["region"]] = per_region.get(it["region"], 0) + 1
        per_source[it["source"]] = per_source.get(it["source"], 0) + 1
        if len(picked) >= limit:
            break
    items = picked

    if use_llm and llm_available():
        items = llm_generate(items)

    final = []
    for it in items:
        dt = it.pop("_dt", None)
        final.append({
            "id": it["id"],
            "title": it.get("title_zh") or it["title"],
            "original_title": it["title"] if (it.get("title_zh") and it["lang"] != "zh") else "",
            "brief": it.get("brief") or it.get("summary", "")[:180],
            "kid": it.get("kid", ""),
            "why": it.get("why", ""),
            "link": it.get("link", ""),
            "source": it["source"],
            "region": it["region"],
            "lang": it["lang"],
            "cat": it["cat"],
            "time": dt.astimezone(CST).strftime("%m-%d %H:%M") if dt else "",
            "ts": dt.timestamp() if dt else 0,
            "summary_raw": it.get("summary", "")[:300],
        })

    feed = {
        "generated_at": datetime.now(CST).strftime("%Y-%m-%d %H:%M"),
        "count": len(final),
        "sources_ok": len(sources) - len(errors),
        "sources_fail": len(errors),
        "errors": errors[:8],
        "llm": bool(use_llm and llm_available()),
        "items": final,
    }

    tmp = FEED_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FEED_PATH)
    return feed


if __name__ == "__main__":
    limit = 60
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    t0 = time.time()
    print("开始抓取全球源…")
    f = collect(limit=limit)
    print("完成：%d 条，用时 %.1fs，来源正常 %d / 失败 %d"
          % (f["count"], time.time() - t0, f["sources_ok"], f["sources_fail"]))
    if f["errors"]:
        print("失败明细：")
        for e in f["errors"]:
            print("  -", e)
    print("已写入", FEED_PATH)
