#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
原理馆扩容：用大模型批量生成「世界说明书」。

    python3 gen_library.py              # 补齐所有缺失主题
    python3 gen_library.py --cat 身体与健康
    python3 gen_library.py --dry        # 只看要生成什么

结果写入 library.json，前端会优先读它。
已经存在的 id 会跳过，所以可以反复运行、随时加主题。
"""

import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "library.json")

CATS = {
    "身体与健康": [
        "医院挂号为什么这么难",
        "一颗药从实验室到药店要走多久",
        "疫苗是怎么起作用的",
        "体检报告上的指标是谁定的",
        "看牙为什么这么贵",
        "急救车为什么有时来得慢",
        "睡觉到底在修复什么",
    ],
    "吃的东西": [
        "一颗菜从地里到你餐桌",
        "冷链是什么，断了会怎样",
        "食品添加剂真的有害吗",
        "保质期是怎么算出来的",
        "一杯奶茶的钱被谁分了",
        "外卖为什么能 30 分钟送到",
        "海鱼是怎么运到内陆的",
    ],
    "住与城市": [
        "自来水的前半生",
        "你家的电从哪里来",
        "燃气怎么进到厨房",
        "你扔的垃圾去哪儿了",
        "地铁是怎么调度的",
        "电梯为什么不会掉下来",
        "物业费到底花在哪",
    ],
    "行与物流": [
        "一个快递是怎么跑到你手上的",
        "高铁为什么能跑 350 公里",
        "飞机为什么能飞起来",
        "港口怎么装卸一个集装箱",
        "红绿灯是谁在控制",
        "导航怎么知道前面堵车",
        "共享单车靠什么赚钱",
    ],
    "钱与金融": [
        "银行靠什么赚钱",
        "保险公司怎么算保费",
        "扫码付款中间经过了谁",
        "股票价格到底是谁定的",
        "基金公司是怎么收费的",
        "汇率是谁定的",
        "通货膨胀是怎么发生的",
    ],
    "工作与职业": [
        "招聘网站怎么把人和岗位配对",
        "工资条上的每一项是什么",
        "社保到底保什么",
        "试用期为什么是三个月",
        "程序员一天在干什么",
        "外卖骑手怎么算收入",
        "会计在公司里做什么",
    ],
    "制造与科技": [
        "芯片是怎么印出来的",
        "屏幕为什么能显示颜色",
        "电池为什么会越用越不耐用",
        "一辆汽车是怎么造出来的",
        "光伏板怎么把光变成电",
        "机器人怎么看见东西",
        "3D 打印怎么造出零件",
    ],
    "法律与规则": [
        "一份合同里到底写了什么",
        "身份证号码里藏了什么",
        "出了交通事故要走哪些流程",
        "打官司为什么这么慢",
        "律师在法庭上到底做什么",
        "遗产是怎么分的",
        "报警之后会发生什么",
    ],
    "教育与成长": [
        "高考分数是怎么算出来的",
        "大学录取是怎么进行的",
        "考研到底在考什么",
        "职业学校教什么",
        "图书馆的书是怎么分类的",
        "一个知识点怎么进教材",
        "留学申请在看什么",
    ],
    "媒体与信息": [
        "一条新闻是怎么生产出来的",
        "热搜是怎么排出来的",
        "推荐算法怎么猜你想看什么",
        "广告怎么精准找到你",
        "版权到底保护什么",
        "谣言为什么跑得比真相快",
        "短视频为什么让人停不下来",
    ],
    "能源与环境": [
        "电网怎么做到每一秒都平衡",
        "一桶石油能变成什么",
        "碳中和到底在算些什么",
        "塑料瓶回收后去了哪里",
        "核电站怎么发电",
        "风力发电机为什么是三片叶",
        "污水处理厂在做什么",
    ],
    "娱乐与体育": [
        "一张电影票的钱怎么分",
        "一款游戏靠什么赚钱",
        "演唱会票价为什么这么高",
        "足球俱乐部靠什么活",
        "奥运会怎么赚钱",
        "直播打赏的钱去了哪",
        "一首歌的版权归谁",
    ],
}

SYSTEM = "你是一个把复杂世界讲给普通人听的编辑，只输出 JSON。"

PROMPT = """为下面这些主题各写一篇「世界说明书」，输出 JSON 数组，不要任何多余文字。

主题：%s

每篇格式：
{
  "id": "英文小写短横线标识，全库唯一",
  "src": "上面给你的主题原话，一字不改地抄回来",
  "em": "一个最贴切的 emoji",
  "cat": "%s",
  "title": "标题。用一个具体的场景或反常识的现象开头，25 字内",
  "one": "一句话说清它是什么、怎么运转，45 字内",
  "steps": [{"t": "环节名，6 字内", "d": "这个环节发生了什么，70 字内"}],
  "money": "钱或利益在这个系统里怎么流动；如果没有钱，就写它最关键的约束。100 字内",
  "remember": "一句话记住它，30 字内",
  "tags": ["标签1", "标签2"]
}

硬性要求：
1. steps 必须 4~5 个，按真实流程排序，讲清楚「谁在做什么」。
2. 全篇禁止专业术语，用小学生能懂的话；必须出现至少一个具体数字（金额、时间、比例）。
3. 不要空话，禁止出现「值得关注」「未来可期」「总之」。
4. title 要勾起好奇，不要写成「XX 概述」。
5. 输出必须是合法 JSON 数组。"""


def call(prompt, cat):
    key = os.environ.get("DD_LLM_KEY")
    base = os.environ.get("DD_LLM_BASE", "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("DD_LLM_MODEL", "gpt-4o-mini")
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 8000,
    }).encode("utf-8")
    req = urllib.request.Request(base + "/chat/completions", data=body, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"].strip()
    text = re.sub(r"^```(json)?|```$", "", text, flags=re.M).strip()
    s, e = text.find("["), text.rfind("]")
    return json.loads(text[s:e + 1])


def load():
    if not os.path.exists(LIB):
        return {"updated_at": "", "cats": [], "items": []}
    try:
        with open(LIB, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"updated_at": "", "cats": [], "items": []}


def main():
    only = None
    if "--cat" in sys.argv:
        only = sys.argv[sys.argv.index("--cat") + 1]
    dry = "--dry" in sys.argv

    lib = load()
    have = {x["id"] for x in lib["items"]}
    src_have = {x.get("src") or x.get("title") for x in lib["items"]}

    todo = []
    for cat, topics in CATS.items():
        if only and cat != only:
            continue
        missing = [t for t in topics if t not in src_have]
        if missing:
            todo.append((cat, missing))

    total = sum(len(m) for _, m in todo)
    print("待生成 %d 篇，已有 %d 篇" % (total, len(lib["items"])))
    if dry:
        for c, m in todo:
            print(" ", c, len(m))
        return

    if not os.environ.get("DD_LLM_KEY"):
        print("需要先设置 DD_LLM_KEY")
        return

    for cat, topics in todo:
        print("· %s（%d 篇）" % (cat, len(topics)))
        rows = []
        for i in range(0, len(topics), 4):
            batch = topics[i:i + 4]
            try:
                rows += call(PROMPT % ("、".join(batch), cat), cat)
                print("   %d/%d" % (min(i + 4, len(topics)), len(topics)))
            except Exception as ex:
                print("   失败：%s" % ex)

        added = 0
        for r in rows:
            if not isinstance(r, dict) or not r.get("id") or not r.get("steps"):
                continue
            if r["id"] in have:
                continue
            r.setdefault("src", "")
            r["cat"] = cat
            r.setdefault("tags", [])
            lib["items"].append(r)
            have.add(r["id"])
            added += 1
        print(" 完成 %d 篇" % added)

        lib["cats"] = list(CATS.keys())
        lib["updated_at"] = time.strftime("%Y-%m-%d %H:%M")
        with open(LIB, "w", encoding="utf-8") as f:
            json.dump(lib, f, ensure_ascii=False, indent=1)
        time.sleep(1)

    print("共 %d 篇，已写入 library.json" % len(lib["items"]))


if __name__ == "__main__":
    main()
