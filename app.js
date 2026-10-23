(function () {
  "use strict";

  var DAILY = window.DAILY || [];
  var LAB = window.LAB || [];
  var WD = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  /* ---------------- 存储 ---------------- */
  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem("dd_" + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem("dd_" + k, JSON.stringify(v)); } catch (e) {}
    }
  };

  var FEED = { items: [] };
  var NOTES = {};
  var LOCAL = null;
  var LIB = { items: [] };

  var S = {
    fav: store.get("fav", []),
    read: store.get("read", []),
    streak: store.get("streak", 0),
    lastOpen: store.get("lastOpen", ""),
    push: store.get("push", { on: false, time: "08:30", last: "" }),
    view: "today",
    offset: 0,
    region: "全部",
    q: "",
    cat: "全部"
  };

  /* ---------------- 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function dkey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function dayOfYear(d) {
    var s = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - s) / 86400000);
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function no3(n) { return ("00" + n).slice(-3); }

  function baseIdx() {
    return (dayOfYear(new Date()) * 7 + 5) % DAILY.length;
  }
  function currentItem() {
    var n = DAILY.length;
    return DAILY[((baseIdx() + S.offset) % n + n) % n];
  }
  function itemNo(it) {
    for (var i = 0; i < DAILY.length; i++) if (DAILY[i].id === it.id) return no3(i + 1);
    return "000";
  }
  function isFav(id) { return S.fav.indexOf(id) > -1; }
  function markRead(id) {
    if (S.read.indexOf(id) === -1) {
      S.read.push(id);
      store.set("read", S.read);
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2400);
  }

  function touchStreak() {
    var t = dkey();
    if (S.lastOpen === t) return;
    var y = new Date(Date.now() - 86400000);
    S.streak = S.lastOpen === dkey(y) ? (S.streak || 0) + 1 : 1;
    S.lastOpen = t;
    store.set("streak", S.streak);
    store.set("lastOpen", S.lastOpen);
  }

  /* ---------------- 今日 ---------------- */
  function heartSVG() {
    return '<svg viewBox="0 0 24 24"><path d="M12 20.3s-7.5-4.6-7.5-9.6a4.35 4.35 0 0 1 7.5-2.95A4.35 4.35 0 0 1 19.5 10.7c0 5-7.5 9.6-7.5 9.6z"/></svg>';
  }

  /* 一条新闻的解读：优先用 ai-notes.json，其次用采集时生成的字段 */
  function noteOf(x) {
    if (!x) return null;
    if (NOTES[x.id]) return NOTES[x.id];
    if (x.kid) return { title: x.title, brief: x.brief, kid: x.kid, why: x.why, cat: x.cat };
    return null;
  }

  /* 早报、盘点这类合辑不适合当「今日精选」 */
  function isDigest(x) {
    var t = x.title || "";
    if (/早报|早知道|晚报|午报|日报|周报|盘点|一览|汇总|快讯集/.test(t)) return true;
    var marks = (t.match(/[；;]/g) || []).length;
    return marks >= 1 || t.length > 42;
  }

  /* 灾害、事故这类不适合当「今日精选」，留在信息流里 */
  function isHeavy(x) {
    return /地震|遇难|死亡|身亡|事故|火灾|坠|袭击|冲突|战争|疫情|病例|洪水|台风/.test(x.title || "");
  }

  function newsPool() {
    return (FEED.items || []).filter(function (x) {
      return noteOf(x) && !isDigest(x) && !isHeavy(x);
    });
  }

  function todayNews() {
    var pool = newsPool();
    if (!pool.length) return null;
    // 只在信息量最高的前 12 条里按天轮换
    var top = pool.slice(0, 12);
    var i = dayOfYear(new Date()) + S.offset;
    return top[((i % top.length) + top.length) % top.length];
  }
  function fmtTime(t) { return t || ""; }

  /* 当前该推什么：优先实时抓取的今日精选 */
  function headline() {
    var n = todayNews();
    if (n) {
      var note = noteOf(n);
      return { title: note.title, sub: n.source + " · " + n.region };
    }
    var it = currentItem();
    return { title: it.title, sub: "第 " + itemNo(it) + " 号 · " + it.region };
  }

  function viewToday() {
    var now = new Date();
    var md = (now.getMonth() + 1) + "月" + now.getDate() + "日";
    var n = todayNews();
    return n ? viewTodayNews(n, now, md) : viewTodayLocal(now, md);
  }

  function daylineHTML(now, md) {
    return '<div class="dayline">' +
        '<div>' +
          '<div class="d1">' + md + ' · ' + WD[now.getDay()] + '</div>' +
          '<div class="d2">DAY ' + dayOfYear(now) + ' / 今日份</div>' +
        '</div>' +
        '<div class="streak">连续 <b>' + (S.streak || 1) + '</b> 天</div>' +
      '</div>';
  }

  function pushHintText() {
    return S.push.on
      ? "每天 " + S.push.time + " 自动送来 · 可在「我的」里修改"
      : "推送还没开 · 去「我的」设一个时间，到点自动来";
  }

  function actionHTML() {
    return '<div class="acts">' +
        '<button class="btn primary" data-act="next">' +
          '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>换一条' +
        '</button>' +
        '<button class="btn" data-act="share">' +
          '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>分享' +
        '</button>' +
      '</div>';
  }

  /* 今日卡：来自实时抓取 + AI 解读 */
  function viewTodayNews(n, now, md) {
    var note = noteOf(n);
    markRead(n.id);
    var src = n.link
      ? '<a class="blk use src-link" href="' + n.link + '" target="_blank" rel="noopener">' +
          '<h4>去读原文</h4>' +
          '<p>' + n.source + ' · ' + n.region + '<span class="go">↗</span></p>' +
        '</a>'
      : '<div class="blk use"><h4>来源</h4><p>' + n.source + ' · ' + n.region + '</p></div>';

    return daylineHTML(now, md) +
      '<article class="card enter" id="card">' +
        '<div class="ctop">' +
          '<span class="no">今日精选</span>' +
          '<span class="chip">' + n.source + '</span>' +
          '<span class="chip cat">' + (note.cat || n.cat) + '</span>' +
          '<button class="icon-btn first" data-act="next" aria-label="换一条">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.4v4.9h-4.9"/></svg>' +
          '</button>' +
          '<button class="fav ' + (isFav(n.id) ? "on" : "") + '" data-act="fav" data-id="' + n.id + '" aria-label="收藏">' + heartSVG() + '</button>' +
        '</div>' +

        '<h1>' + note.title + '</h1>' +
        '<p class="hook">' + note.brief + '</p>' +

        '<div class="blk kid">' +
          '<h4>说人话</h4>' +
          '<p>' + note.kid + '</p>' +
        '</div>' +

        '<div class="blk why">' +
          '<h4>信息差到底差在哪</h4>' +
          '<p>' + note.why + '</p>' +
        '</div>' +

        src +

        '<div class="tags">' +
          '<span class="tag">#' + n.source + '</span>' +
          '<span class="tag">#' + n.region + '</span>' +
          '<span class="tag">#' + fmtTime(n.time) + ' 抓取</span>' +
        '</div>' +
      '</article>' +

      actionHTML() +
      '<p class="hint">' + pushHintText() + '<br>今日这条来自实时抓取，全部 ' +
        (FEED.count || 0) + ' 条在「信息流」里。</p>';
  }

  /* 今日卡：内置精选（没有网络或没有解读时的兜底） */
  function viewTodayLocal(now, md) {
    var it = currentItem();
    markRead(it.id);

    return daylineHTML(now, md) +
      '<article class="card enter" id="card">' +
        '<div class="ctop">' +
          '<span style="font-size:17px;line-height:1">' + it.em + '</span>' +
          '<span class="no">No.' + itemNo(it) + '</span>' +
          '<span class="chip">' + it.region + '</span>' +
          '<span class="chip cat">' + it.cat + '</span>' +
          '<button class="icon-btn first" data-act="next" aria-label="换一条">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.4v4.9h-4.9"/></svg>' +
          '</button>' +
          '<button class="fav ' + (isFav(it.id) ? "on" : "") + '" data-act="fav" data-id="' + it.id + '" aria-label="收藏">' + heartSVG() + '</button>' +
        '</div>' +

        '<h1>' + it.title + '</h1>' +
        '<p class="hook">' + it.hook + '</p>' +

        '<div class="blk kid">' +
          '<h4>说人话</h4>' +
          '<p>' + it.kid + '</p>' +
        '</div>' +

        '<div class="blk why">' +
          '<h4>信息差到底差在哪</h4>' +
          '<p>' + it.why + '</p>' +
        '</div>' +

        '<div class="blk use">' +
          '<h4>你能怎么用</h4>' +
          '<p>' + it.use + '</p>' +
        '</div>' +

        '<div class="tags">' + it.tags.map(function (t) { return '<span class="tag">#' + t + '</span>'; }).join("") + '</div>' +
      '</article>' +

      actionHTML() +
      '<p class="hint">' + pushHintText() + '<br>今日这条是固定的，换一条只是加餐。</p>';
  }

  /* ---------------- 同一件事，不同的说法 ---------------- */
  function clustersHTML() {
    var cs = (FEED.clusters || []);
    if (!cs.length) return "";
    var html = cs.map(function (c) {
      var rows = (c.items || []).map(function (it) {
        return '<div class="cl-row">' +
            '<span class="cl-region">' + it.region + '</span>' +
            '<span class="cl-src">' + it.source + '</span>' +
            '<span class="cl-t">' + it.title + '</span>' +
          '</div>';
      }).join("");
      return '<div class="cluster">' +
          '<div class="cl-kicker">同一件事 · 不同说法</div>' +
          '<div class="cl-topic">' + c.topic + '</div>' +
          '<div class="cl-items">' + rows + '</div>' +
          '<div class="cl-diff">' + c.diff + '</div>' +
        '</div>';
    }).join("");
    return '<div class="clusters">' + html + '</div>';
  }

  /* ---------------- 信息流 ---------------- */
  function viewFeed() {
    var items = FEED.items || [];
    if (!items.length) {
      return '<div class="sec-hd">信息流</div>' +
        '<p class="sec-sub">还没有抓到内容。在电脑上运行一次 <b>python3 collector.py</b>，' +
        '或者用本地服务打开这个页面（<b>python3 serve.py</b>），它就会自动更新。</p>';
    }

    var regions = [];
    items.forEach(function (x) {
      if (regions.indexOf(x.region) < 0) regions.push(x.region);
    });
    var cur = S.region;
    var list = items.filter(function (x) { return cur === "全部" || x.region === cur; });

    var filters = ['全部'].concat(regions).map(function (r) {
      return '<button class="filter ' + (r === cur ? "on" : "") + '" data-act="region" data-id="' + r + '">' + r + '</button>';
    }).join("");

    var html = list.map(function (x) {
      var note = noteOf(x);
      var title = note ? note.title : x.title;
      var desc = note ? note.brief : (x.brief || "").slice(0, 90);
      if (!desc) desc = x.lang === "zh" ? "" : "英文原文 · 配置 AI 后可自动翻成中文";
      return '' +
        '<div class="feed-item" data-act="openNews" data-id="' + x.id + '">' +
          '<div class="fi-top">' +
            '<span class="fi-src">' + x.source + '</span>' +
            '<span class="fi-cat">' + (note && note.cat ? note.cat : x.cat) + '</span>' +
            (note ? '<span class="fi-ai">AI 解读</span>' : '') +
            (x.lang !== "zh" ? '<span class="fi-lang">原文</span>' : '') +
            '<span class="fi-time">' + (x.time || "") + '</span>' +
          '</div>' +
          '<h3>' + title + '</h3>' +
          (desc ? '<p>' + desc + '</p>' : '') +
        '</div>';
    }).join("");

    return '<div class="feed-hd">' +
        '<div class="sec-hd">信息流</div>' +
        (window.__FEED__ ? '<span class="offline-tag">离线版</span>'
                         : '<button class="ghost-btn" data-act="refresh">刷新</button>') +
      '</div>' +
      '<p class="sec-sub">' + (FEED.generated_at || "") + ' 更新 · ' +
        (FEED.count || items.length) + ' 条 · ' + (FEED.sources_ok || "?") + ' 个源' +
        (FEED.llm ? '' : ' · 英文源保留原文') + '</p>' +
      clustersHTML() +
      '<div class="filters">' + filters + '</div>' +
      html;
  }

  /* ---------------- 原理馆 ---------------- */
  function allLab() {
    var seen = {}, out = [];
    (LIB.items || []).concat(LAB).forEach(function (x) {
      if (!x || !x.id || seen[x.id]) return;
      seen[x.id] = 1;
      out.push(x);
    });
    return out;
  }

  function labCats() {
    var c = [];
    allLab().forEach(function (x) { if (x.cat && c.indexOf(x.cat) < 0) c.push(x.cat); });
    return c;
  }

  function labFiltered() {
    var q = (S.q || "").trim().toLowerCase();
    var cat = S.cat || "全部";
    return allLab().filter(function (x) {
      if (cat !== "全部" && x.cat !== cat) return false;
      if (!q) return true;
      var hay = (x.title + " " + x.one + " " + (x.tags || []).join(" ") + " " + x.cat).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function labItemHTML(p) {
    var read = S.read.indexOf(p.id) > -1;
    return '<div class="lab-item" data-act="openLab" data-id="' + p.id + '">' +
        '<div class="lab-em">' + p.em + '</div>' +
        '<div style="flex:1">' +
          '<h3>' + p.title + (read ? '<span class="read-dot" title="读过了"></span>' : '') + '</h3>' +
          '<p>' + p.one + '</p>' +
        '</div>' +
        '<div class="lab-go">›</div>' +
      '</div>';
  }

  function labListHTML() {
    var items = labFiltered();
    if (!items.length) {
      return '<p class="empty">没找到。换个词试试，比如「电」「钱」「快递」「工资」。</p>';
    }
    return items.map(labItemHTML).join("");
  }

  function viewLab() {
    var cats = labCats();
    var cur = S.cat || "全部";
    var chips = ["全部"].concat(cats).map(function (c) {
      return '<button class="filter ' + (c === cur ? "on" : "") + '" data-act="labcat" data-id="' + c + '">' + c + '</button>';
    }).join("");

    return '<div class="sec-hd">原理馆</div>' +
      '<p class="sec-sub">这个世界是怎么运转的。共 ' + allLab().length +
        ' 篇，每篇 4~5 步，读完 2 分钟，不用懂专业词。</p>' +
      '<div class="lab-bar">' +
      '<div class="searchbox">' +
        '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>' +
        '<input id="labSearch" type="search" placeholder="搜一个你好奇的东西：电、快递、工资、疫苗…" value="' + (S.q || "") + '">' +
      '</div>' +
      '<div class="filters">' + chips + '</div>' +
      '</div>' +
      '<div id="labList">' + labListHTML() + '</div>';
  }

  /* ---------------- 我的 ---------------- */
  function permText() {
    if (!("Notification" in window)) return "这个浏览器不支持系统通知";
    var p = Notification.permission;
    if (p === "granted") return "系统通知已允许";
    if (p === "denied") return "系统通知被拒绝，可在浏览器设置里改";
    return "还没允许系统通知";
  }

  function viewMe() {
    var favs = S.fav.map(function (id) {
      var it = null;
      for (var i = 0; i < DAILY.length; i++) if (DAILY[i].id === id) it = DAILY[i];
      if (!it) return "";
      return '' +
        '<div class="mini-fav" data-act="openDaily" data-id="' + it.id + '">' +
          '<span class="em">' + it.em + '</span>' +
          '<span class="tx">' + it.title + '</span>' +
          '<span class="ar">›</span>' +
        '</div>';
    }).join("");

    var canNotify = "Notification" in window;

    return '' +
      '<div class="sec-hd">我的</div>' +
      '<p class="sec-sub">数据都存在你这台设备上，不上传、不登录。</p>' +

      '<div class="stats">' +
        '<div class="stat"><b>' + (S.streak || 1) + '</b><span>连续天数</span></div>' +
        '<div class="stat"><b>' + S.read.length + '</b><span>已读条目</span></div>' +
        '<div class="stat"><b>' + S.fav.length + '</b><span>收藏</span></div>' +
      '</div>' +

      '<div class="me-card">' +
        '<h3><span>⏰</span>每天自动推送</h3>' +
        '<p class="me-note">到点把当天的卡片推到你手机上。需要先允许系统通知；如果没允许，打开 App 也会直接看到当天内容。</p>' +
        '<div class="row">' +
          '<div class="lbl">开启每日推送<small>' + permText() + '</small></div>' +
          '<button class="sw ' + (S.push.on ? "on" : "") + '" data-act="swPush" aria-label="开关"></button>' +
        '</div>' +
        '<div class="row">' +
          '<div class="lbl">推送时间</div>' +
          '<input type="time" id="pushTime" value="' + S.push.time + '" data-change="pushTime">' +
        '</div>' +
        '<div class="row">' +
          '<div class="lbl">通知权限</div>' +
          '<button class="ghost-btn" data-act="askPerm">' + (canNotify ? "申请" : "不支持") + '</button>' +
        '</div>' +
        '<div class="row">' +
          '<div class="lbl">现在就试一条<small>看看推送长什么样</small></div>' +
          '<button class="ghost-btn" data-act="testPush">发送</button>' +
        '</div>' +
      '</div>' +

      (LOCAL ? '<div class="me-card">' +
        '<h3><span>▣</span>在手机上打开</h3>' +
        '<p class="me-note">手机连同一个 WiFi，扫码即开。打开后点浏览器菜单里的「添加到主屏幕」，下次一点就进。</p>' +
        '<div class="qr-wrap"><img src="./qr.png" alt="手机访问二维码" onerror="this.parentNode.style.display=\'none\'"></div>' +
        '<div class="qr-url">' + LOCAL.url + '</div>' +
      '</div>' : '') +

      '<div class="me-card">' +
        '<h3><span>◎</span>数据源</h3>' +
        '<p class="me-note">' + (FEED.generated_at
            ? '最后更新 ' + FEED.generated_at + '，收录 ' + (FEED.count || 0) + ' 条，' + (FEED.sources_ok || 0) + ' 个源可用。'
            : '还没有抓到内容。运行 collector.py 抓一次，或 serve.py 让它每天自动更新。') +
          '要让它每天自动抓，在电脑上运行 <b>python3 serve.py</b>，页面保持打开即可。' +
        '</p>' +
        '<div class="row"><div class="lbl">AI 解读<small>配置 DD_LLM_KEY 后自动生成</small></div>' +
          '<div class="val">' + (FEED.items || []).filter(function (x) { return x.kid; }).length + ' 条</div></div>' +
        '<div class="row"><div class="lbl">英文源<small>没配 AI 时保留原文</small></div>' +
          '<div class="val">' + (FEED.items || []).filter(function (x) { return x.lang !== 'zh'; }).length + ' 条</div></div>' +
      '</div>' +

      '<div class="me-card">' +
        '<h3><span>♥</span>我的收藏</h3>' +
        (favs || '<p class="empty">还没有收藏。看到想留着的，点卡片右上角那颗心。</p>') +
      '</div>' +

      '<div class="me-card">' +
        '<h3><span>✎</span>关于这个小东西</h3>' +
        '<p class="me-note">每天一条：一个国家和它「反常识」的日常。原理馆：把行业拆成小学生也能跟上的步骤。</p>' +
        '<div class="row">' +
          '<div class="lbl">装到桌面<small>iPhone：分享 → 添加到主屏幕；安卓：菜单 → 安装应用</small></div>' +
          '<div class="val">像 App 一样</div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="lbl">内容数量<small>每天轮换，看完自动循环</small></div>' +
          '<div class="val">' + DAILY.length + ' + ' + LAB.length + ' 篇</div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="lbl">数据存在哪<small>只在这台设备，不登录、不上传</small></div>' +
          '<div class="val">本机</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var main = $("#main");
    var html;
    if (S.view === "feed") html = viewFeed();
    else if (S.view === "lab") html = viewLab();
    else if (S.view === "me") html = viewMe();
    else html = viewToday();
    main.innerHTML = html;
    main.scrollTop = 0;

    var tabs = document.querySelectorAll("#tabbar button");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("on", tabs[i].getAttribute("data-view") === S.view);
    }
  }

  /* ---------------- 详情面板 ---------------- */
  var sheet = $("#sheet");
  var sheetBody = $("#sheetBody");

  function openSheet() {
    sheet.classList.add("on");
    sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    sheet.classList.remove("on");
    sheet.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(function () {
      if (!sheet.classList.contains("on")) sheetBody.innerHTML = "";
      if (S.view === "lab") {
        var box = $("#labList");
        if (box) box.innerHTML = labListHTML();
      }
    }, 360);
  }

  function openLab(id) {
    var p = null;
    var all = allLab();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) p = all[i];
    if (!p) return;
    markRead(p.id);

    var steps = p.steps.map(function (s) {
      return '<div class="step"><b>' + s.t + '</b><p>' + s.d + '</p></div>';
    }).join("");

    sheetBody.innerHTML = '' +
      '<div class="sd-top"><div class="grab"></div><button class="sd-x" data-close aria-label="关闭">✕</button></div>' +
      '<div class="sd-em">' + p.em + '</div>' +
      '<h2 class="sd-title">' + p.title + '</h2>' +
      '<p class="sd-one">' + p.one + '</p>' +
      '<div class="steps">' + steps + '</div>' +
      '<div class="money"><b>钱是怎么分的</b>' + p.money + '</div>' +
      '<div class="remember">' + p.remember + '</div>' +
      '<button class="sd-close" data-close>收起</button>';
    openSheet();
  }

  function openNews(id) {
    var n = null;
    (FEED.items || []).forEach(function (x) { if (x.id === id) n = x; });
    if (!n) return;
    var note = noteOf(n);

    var head = '<div class="sd-top"><div class="grab"></div><button class="sd-x" data-close aria-label="关闭">✕</button></div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin:16px 0 10px">' +
        '<span class="chip">' + n.source + '</span>' +
        '<span class="chip cat">' + (note && note.cat ? note.cat : n.cat) + '</span>' +
        '<span class="fi-time" style="margin-left:auto">' + (n.time || "") + '</span>' +
      '</div>';

    var body = '<h2 class="sd-title">' + (note ? note.title : n.title) + '</h2>';

    if (n.original_title) {
      body += '<p class="sd-origin">' + n.original_title + '</p>';
    }

    if (note) {
      body += '<p class="sd-one">' + note.brief + '</p>' +
        '<div class="blk kid" style="margin-top:18px"><h4>说人话</h4><p>' + note.kid + '</p></div>' +
        '<div class="blk why"><h4>信息差到底差在哪</h4><p>' + note.why + '</p></div>';
    } else {
      var raw = n.summary_raw || n.brief || "";
      if (raw) body += '<p class="sd-one">' + raw + '</p>';
    }

    body += '<div class="money" style="margin-top:20px"><b>原始来源</b>' +
      n.source + ' · ' + n.region + (n.link ? '' : ' · 无链接') + '</div>';

    if (n.link) {
      body += '<a class="sd-link" href="' + n.link + '" target="_blank" rel="noopener">去读原文 ↗</a>';
    }

    sheetBody.innerHTML = head + body +
      '<button class="sd-close" data-close>收起</button>';
    openSheet();
  }

  function openDaily(id) {
    var it = null;
    for (var i = 0; i < DAILY.length; i++) if (DAILY[i].id === id) it = DAILY[i];
    if (!it) return;

    sheetBody.innerHTML = '' +
      '<div class="sd-top"><div class="grab"></div><button class="sd-x" data-close aria-label="关闭">✕</button></div>' +
      '<div class="sd-em">' + it.em + '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        '<span class="chip">' + it.region + '</span><span class="chip cat">' + it.cat + '</span>' +
      '</div>' +
      '<h2 class="sd-title">' + it.title + '</h2>' +
      '<p class="sd-one">' + it.hook + '</p>' +
      '<div class="blk kid" style="margin-top:18px"><h4>说人话</h4><p>' + it.kid + '</p></div>' +
      '<div class="blk why"><h4>信息差到底差在哪</h4><p>' + it.why + '</p></div>' +
      '<div class="blk use"><h4>你能怎么用</h4><p>' + it.use + '</p></div>' +
      '<button class="sd-close" data-close>收起</button>';
    openSheet();
  }

  /* ---------------- 推送 ---------------- */
  function canNotify() { return "Notification" in window; }

  function notify(title, body) {
    try {
      if (canNotify() && Notification.permission === "granted") {
        new Notification(title, { body: body, tag: "dd-daily", renotify: true });
        return true;
      }
    } catch (e) {
      /* 部分手机浏览器要求走 Service Worker，失败就退回 App 内提示 */
    }
    return false;
  }

  function askPerm() {
    if (!canNotify()) { toast("这个浏览器不支持系统通知"); return; }
    if (Notification.permission === "granted") { toast("已经是允许状态了"); return; }
    Notification.requestPermission().then(function (r) {
      render();
      if (r === "granted") toast("好了，到点我会来叫你");
      else toast("没授权。打开 App 也能看到当天内容");
    }).catch(function () { toast("这个环境不支持申请通知"); });
  }

  function testPush() {
    var h = headline();
    var ok = notify(h.title, h.sub);
    if (!ok) toast("没有通知权限，这里是预览：" + h.title);
    else toast("已发送，看看通知栏");
  }

  function checkPush() {
    if (!S.push.on) return;
    if (!canNotify() || Notification.permission !== "granted") return;
    var now = new Date();
    var t = dkey(now);
    if (S.push.last === t) return;
    var parts = String(S.push.time).split(":");
    var h = parseInt(parts[0], 10) || 0;
    var m = parseInt(parts[1], 10) || 0;
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (now >= target) {
      var h = headline();
      notify(h.title, h.sub);
      if (!document.hidden) toast("到点了 · 今天的内容已更新");
      S.push.last = t;
      store.set("push", S.push);
    }
  }

  /* ---------------- 事件 ---------------- */
  $("#main").addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    var id = el.getAttribute("data-id");

    if (act === "fav") {
      var i = S.fav.indexOf(id);
      if (i > -1) { S.fav.splice(i, 1); toast("已取消收藏"); }
      else { S.fav.unshift(id); toast("收好了，在「我的」里能找到"); }
      store.set("fav", S.fav);
      render();
    } else if (act === "next") {
      S.offset = (S.offset + 1) % DAILY.length;
      render();
    } else if (act === "refresh") {
      toast("正在抓取，大概要 30 秒…");
      fetch("./api/refresh", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (f) {
          if (f && f.items && f.items.length) {
            FEED = f;
            render();
            toast("已更新 · " + f.count + " 条");
          } else {
            toast("没抓到新内容，稍后再试");
          }
        })
        .catch(function () { toast("需要在电脑上运行 python3 serve.py 才能实时抓取"); });
    } else if (act === "labcat") {
      S.cat = id;
      render();
    } else if (act === "region") {
      S.region = id;
      render();
    } else if (act === "openNews") {
      openNews(id);
    } else if (act === "share") {
      var n = todayNews();
      var title, text;
      if (n) {
        var note = noteOf(n);
        title = note.title;
        text = note.title + "\n\n" + note.brief + "\n\n" + note.kid + "\n\n—— 每日信息差 · 来自 " + n.source;
      } else {
        var it = currentItem();
        title = it.title;
        text = it.title + "\n\n" + it.hook + "\n\n" + it.kid + "\n\n—— 每日信息差 No." + itemNo(it);
      }
      if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { toast("已复制，去粘贴给朋友"); }).catch(function () {
          toast("长按文字可以手动复制");
        });
      } else {
        toast("长按文字可以手动复制");
      }
    } else if (act === "openLab") {
      openLab(id);
    } else if (act === "openDaily") {
      openDaily(id);
    } else if (act === "swPush") {
      S.push.on = !S.push.on;
      store.set("push", S.push);
      render();
      if (S.push.on) {
        if (canNotify() && Notification.permission === "default") askPerm();
        else toast("已开启，每天 " + S.push.time + " 推给你");
      } else {
        toast("已关闭每日推送");
      }
    } else if (act === "askPerm") {
      askPerm();
    } else if (act === "testPush") {
      testPush();
    }
  });

  $("#main").addEventListener("input", function (e) {
    if (e.target && e.target.id === "labSearch") {
      S.q = e.target.value;
      var box = $("#labList");
      if (box) box.innerHTML = labListHTML();
    }
  });

  $("#main").addEventListener("change", function (e) {
    var el = e.target.closest("[data-change]");
    if (!el) return;
    if (el.getAttribute("data-change") === "pushTime") {
      S.push.time = el.value || "08:30";
      S.push.last = "";
      store.set("push", S.push);
      toast("推送时间改成 " + S.push.time);
      render();
    }
  });

  $("#tabbar").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    S.view = b.getAttribute("data-view");
    if (S.view === "today") S.offset = 0;
    render();
  });

  $("#btnToday").addEventListener("click", function () {
    S.view = "today";
    S.offset = 0;
    render();
  });

  sheet.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) closeSheet();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSheet();
  });

  /* 下拉一点点时给顶栏加阴影（细节） */
  var mainEl = $("#main");
  mainEl.addEventListener("scroll", function () {
    $(".topbar").style.boxShadow = mainEl.scrollTop > 6 ? "0 8px 18px -18px rgba(74,52,24,.8)" : "none";
  }, { passive: true });

  /* ---------------- 加载实时内容 ---------------- */
  function loadFeed() {
    if (window.__LIB__) LIB = window.__LIB__;
    // 单文件离线版：数据直接嵌在页面里
    if (window.__FEED__) {
      FEED = window.__FEED__;
      NOTES = window.__NOTES__ || {};
      render();
      return;
    }
    if (!window.fetch) return;
    function j(u) {
      return fetch(u, { cache: "no-store" }).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; });
    }
    Promise.all([j("./feed.json"), j("./ai-notes.json"), j("./local.json"), j("./library.json")]).then(function (res) {
      if (res[0] && res[0].items && res[0].items.length) FEED = res[0];
      if (res[1] && res[1].notes) NOTES = res[1].notes;
      if (res[2] && res[2].url) LOCAL = res[2];
      if (res[3] && res[3].items) LIB = res[3];
      if (S.view === "today" || S.view === "feed") render();
    }).catch(function () {});
  }

  /* ---------------- 启动 ---------------- */
  touchStreak();
  render();
  loadFeed();
  setTimeout(checkPush, 1200);
  setInterval(checkPush, 20000);

  /* 页面重新可见时立刻补一次检查（手机后台会冻结定时器） */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(checkPush, 400);
  });

  /* 第一次来，给一句引导 */
  if (!store.get("seen", false)) {
    setTimeout(function () {
      toast("右上角换一条 · 底部还有信息流和原理馆");
      store.set("seen", true);
    }, 1600);
  }

  /* 装到桌面 + 断网可用 */
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }

  /* 支持用链接直达某一页 / 某一条（方便分享） */
  (function () {
    var qs = new URLSearchParams(location.search);
    var v = qs.get("v");
    if (v === "lab" || v === "me") { S.view = v; render(); }
    var id = qs.get("id");
    if (id) {
      for (var i = 0; i < LAB.length; i++) if (LAB[i].id === id) { openLab(id); return; }
      for (var j = 0; j < DAILY.length; j++) if (DAILY[j].id === id) { openDaily(id); return; }
    }
  })();
})();
