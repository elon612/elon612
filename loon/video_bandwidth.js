/**
 * Loon 节点下载带宽抽样（低频批量）
 *
 * generic：插件/脚本列表点一下，或长按某个节点只测这一条
 * cron：默认关闭，插件参数里打开
 *
 * 用 Range/定长下载测吞吐，不是 generate_204 延迟。
 */
var STORE_KEY = "video_bandwidth_last";
var SKIP = {
  DIRECT: 1,
  REJECT: 1,
  "REJECT-DROP": 1,
  "REJECT-NO-DROP": 1,
  PROXY: 1
};

var TARGETS = {
  cloudflare: "https://speed.cloudflare.com/__down?bytes=SIZE",
  twitter:
    "https://video.twimg.com/amplify_video/2088905978905608192/vid/avc1/1080x1440/AaaqNwuX5qTlP-VT.mp4?tag=29",
  google:
    "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg"
};

function readArgs() {
  var raw = typeof $argument === "undefined" ? {} : $argument;
  var o = {};
  var i;
  var kv;
  var p;
  if (raw == null || raw === "") {
    o = {};
  } else if (typeof raw === "object") {
    o = raw;
  } else if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch (e) {
      raw.split("&").forEach(function (pair) {
        p = pair.indexOf("=");
        if (p > 0) {
          o[decodeURIComponent(pair.slice(0, p))] = decodeURIComponent(
            pair.slice(p + 1)
          );
        }
      });
    }
  }
  function pick(k, d) {
    var v = o[k];
    if (v == null || v === "") return d;
    return String(v);
  }
  var bytesMB = parseInt(pick("bytesMB", "4"), 10);
  if (!(bytesMB > 0)) bytesMB = 4;
  if (bytesMB > 8) bytesMB = 8;
  var maxNodes = parseInt(pick("maxNodes", "12"), 10);
  if (!(maxNodes > 0)) maxNodes = 12;
  if (maxNodes > 24) maxNodes = 24;
  return {
    policy: pick("policy", "ALL_Filter"),
    include: pick("include", "香港|新加坡|泰国|日本|JMS|TX|AWS|HGC|IEPL"),
    exclude: pick("exclude", "0\\.01x|0\\.3x|0\\.5x|剩余流量|套餐到期|官网|发布页|测试"),
    bytesMB: bytesMB,
    maxNodes: maxNodes,
    testTarget: pick("testTarget", "twitter"),
    notifyAll: pick("notifyAll", "true") !== "false"
  };
}

function envNode() {
  try {
    if (typeof $environment === "undefined" || !$environment.params) return "";
    var p = $environment.params;
    if (p.nodeInfo) {
      var info = p.nodeInfo;
      if (typeof info === "string") {
        try {
          info = JSON.parse(info);
        } catch (e) {
          info = null;
        }
      }
      if (info && info.name) return String(info.name);
    }
    if (p.node) return String(p.node);
  } catch (e) {}
  return "";
}

function compileRe(src, fallback) {
  if (!src) return fallback;
  try {
    return new RegExp(src, "i");
  } catch (e) {
    return fallback;
  }
}

function parseCfg() {
  try {
    return JSON.parse($config.getConfig() || "{}");
  } catch (e) {
    return {};
  }
}

function asList(subs) {
  if (!subs) return [];
  if (Array.isArray(subs)) return subs;
  if (typeof subs === "string") {
    try {
      var p = JSON.parse(subs);
      if (Array.isArray(p)) return p;
    } catch (e) {}
    if (subs) return [subs];
  }
  return [];
}

function gather(root, done) {
  var cfg = parseCfg();
  var groupSet = {};
  (cfg.all_policy_groups || []).forEach(function (g) {
    groupSet[g] = 1;
  });
  var seen = {};
  var nodes = [];
  var pending = 0;
  var finished = false;

  function end() {
    if (finished) return;
    finished = true;
    done(nodes);
  }

  function walk(name, depth) {
    if (finished) return;
    if (!name || seen[name] || depth > 6) return;
    seen[name] = 1;
    if (SKIP[name]) return;
    pending++;
    $config.getSubPolicies(name, function (subs) {
      var list = asList(subs);
      if (!list.length) {
        nodes.push(name);
      } else {
        var onlyGroups = true;
        var i;
        var child;
        for (i = 0; i < list.length; i++) {
          child = list[i];
          if (!groupSet[child] && !SKIP[child]) onlyGroups = false;
        }
        // 过滤器/策略组：继续往下；否则这一层就是节点名
        if (groupSet[name] || /Filter|_Auto|_Manual|AutoTest|Available|Fallback/i.test(name)) {
          for (i = 0; i < list.length; i++) walk(list[i], depth + 1);
        } else if (onlyGroups) {
          for (i = 0; i < list.length; i++) walk(list[i], depth + 1);
        } else {
          for (i = 0; i < list.length; i++) {
            child = list[i];
            if (!SKIP[child] && !groupSet[child] && !seen[child]) {
              seen[child] = 1;
              nodes.push(child);
            }
          }
        }
      }
      pending--;
      if (pending <= 0) end();
    });
  }

  walk(root, 0);
  if (pending <= 0) {
    // getSubPolicies 异步，通常 pending>0；若同步空则兜底
    setTimeout(function () {
      if (pending <= 0) end();
    }, 50);
  }
  setTimeout(function () {
    if (!finished) end();
  }, 15000);
}

function scoreName(n) {
  if (/JMS|TX\b|AWS|IEPL|高级|HGC|泰国|Home|🏠/i.test(n)) return 3;
  if (/0\.0?1x|0\.3x|0\.5x/.test(n)) return 0;
  if (/优化/.test(n)) return 1;
  return 2;
}

function pickNodes(all, args) {
  var inc = compileRe(args.include, /./);
  var exc = compileRe(args.exclude, /^\b$/);
  var out = [];
  var i;
  var n;
  for (i = 0; i < all.length; i++) {
    n = all[i];
    if (!n || SKIP[n]) continue;
    if (/剩余流量|套餐到期|官网|发布页|重置流量/.test(n)) continue;
    if (args.include && !inc.test(n)) continue;
    if (args.exclude && exc.test(n)) continue;
    out.push(n);
  }
  out.sort(function (a, b) {
    return scoreName(b) - scoreName(a) || a.localeCompare(b);
  });
  if (out.length > args.maxNodes) out = out.slice(0, args.maxNodes);
  return unique(out);
}

function unique(arr) {
  var s = {};
  var o = [];
  arr.forEach(function (x) {
    if (!s[x]) {
      s[x] = 1;
      o.push(x);
    }
  });
  return o;
}

function byteLen(data) {
  if (!data) return 0;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

function header(h, k) {
  if (!h) return "";
  return h[k] || h[k.toLowerCase()] || h[k.toUpperCase()] || "";
}

function testUrl(args) {
  var bytes = args.bytesMB * 1048576;
  var key = args.testTarget || "twitter";
  var u = TARGETS[key] || TARGETS.twitter;
  return u.replace("SIZE", String(bytes));
}

function useRange(url) {
  return url.indexOf("speed.cloudflare.com") < 0;
}

function probe(name, url, bytes, timeoutMs, cb) {
  var t0 = Date.now();
  var headers = { "User-Agent": "Loon-VideoBandwidth/1.0" };
  if (useRange(url) && bytes > 0) {
    headers.Range = "bytes=0-" + (bytes - 1);
  }
  $httpClient.get(
    {
      url: url,
      timeout: timeoutMs,
      node: name,
      "binary-mode": true,
      "auto-redirect": true,
      headers: headers
    },
    function (error, response, data) {
      var ms = Math.max(1, Date.now() - t0);
      var status = response && response.status ? response.status : 0;
      var n = byteLen(data);
      var cl = parseInt(header(response && response.headers, "content-length"), 10);
      if (cl > n) n = cl;
      var ok = !error && status > 0 && status < 400 && n > 1024;
      var MBps = n / 1048576 / (ms / 1000);
      cb({
        name: name,
        ok: ok,
        status: status,
        error: error ? String(error) : "",
        bytes: n,
        ms: ms,
        MBps: MBps
      });
    }
  );
}

function fmtSpeed(x) {
  if (!x || x <= 0) return "—";
  if (x < 0.1) return (x * 1024).toFixed(0) + " KB/s";
  return x.toFixed(2) + " MB/s";
}

function shortName(n) {
  return n.length > 28 ? n.slice(0, 26) + "…" : n;
}

function finish(args, target, results) {
  results.sort(function (a, b) {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return b.MBps - a.MBps;
  });
  var lines = [];
  var i;
  var r;
  var okN = 0;
  for (i = 0; i < results.length; i++) {
    r = results[i];
    if (r.ok) okN++;
    lines.push(
      i +
        1 +
        ". " +
        shortName(r.name) +
        "  " +
        (r.ok ? fmtSpeed(r.MBps) : r.status === 403 ? "403" : r.error || "失败")
    );
  }
  var title = "视频带宽 " + okN + "/" + results.length;
  var sub = target + " · " + args.bytesMB + "MB 抽样";
  var body = lines.slice(0, 10).join("\n");
  if (!results.length) body = "没有可测节点。检查策略组/过滤器名称，或长按单个节点。";
  try {
    $persistentStore.write(
      JSON.stringify({
        at: Date.now(),
        target: target,
        results: results
      }),
      STORE_KEY
    );
  } catch (e) {}
  console.log(title + " " + sub + "\n" + lines.join("\n"));
  if (args.notifyAll) {
    $notification.post(title, sub, body, { clipboard: lines.join("\n") });
  }
  $done();
}

function runBatch(names, args) {
  var url = testUrl(args);
  var bytes = args.bytesMB * 1048576;
  var timeoutMs = 15000;
  var results = [];
  var i = 0;
  if (!names.length) {
    finish(args, args.testTarget, results);
    return;
  }
  $notification.post(
    "开始测带宽",
    names.length + " 个节点 · " + args.bytesMB + "MB",
    names.slice(0, 6).join("、") + (names.length > 6 ? "…" : "")
  );
  function next() {
    if (i >= names.length) {
      finish(args, args.testTarget, results);
      return;
    }
    var name = names[i++];
    probe(name, url, bytes, timeoutMs, function (res) {
      results.push(res);
      setTimeout(next, 400);
    });
  }
  next();
}

function main() {
  var args = readArgs();
  var one = envNode();
  if (one) {
    runBatch([one], args);
    return;
  }
  gather(args.policy, function (all) {
    var names = pickNodes(all, args);
    if (!names.length && args.policy !== "ALL_Filter") {
      gather("ALL_Filter", function (all2) {
        runBatch(pickNodes(all2.length ? all2 : all, args), args);
      });
      return;
    }
    runBatch(names, args);
  });
}

main();
