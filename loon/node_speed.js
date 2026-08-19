/**
 * 长按某个节点 → 只测这一条的下载速度
 *
 * [Script]
 * generic script-path=https://raw.githubusercontent.com/elon612/elon612/main/loon/node_speed.js,tag=测一下带宽,timeout=20,img-url=speedometer.system
 */
var params = $environment.params || {};
var nodeName = params.node;
if (!nodeName && params.nodeInfo) {
  var info = params.nodeInfo;
  if (typeof info === "string") {
    try {
      info = JSON.parse(info);
    } catch (e) {
      info = {};
    }
  }
  nodeName = info && info.name;
}

if (!nodeName) {
  $done({
    title: "测一下带宽",
    htmlMessage:
      '<p style="text-align:center;font-family:-apple-system;font-size:large">请长按一个节点再运行</p>'
  });
} else {
  var t0 = Date.now();
  $httpClient.get(
    {
      url: "https://speed.cloudflare.com/__down?bytes=1048576",
      node: nodeName,
      timeout: 15000,
      "binary-mode": true
    },
    function (error, response, data) {
      var ms = Date.now() - t0;
      var status = response && response.status ? response.status : 0;
      var n = 0;
      if (data) {
        if (typeof data.byteLength === "number") n = data.byteLength;
        else if (typeof data.length === "number") n = data.length;
      }
      var body;
      if (error) {
        body = "失败<br>" + error;
      } else if (n < 1024) {
        body = "几乎没下到数据<br>HTTP " + status + " · " + ms + " ms";
      } else {
        var speed = n / 1048576 / (ms / 1000);
        body =
          speed.toFixed(2) +
          " MB/s<br>" +
          (n / 1024).toFixed(0) +
          " KB / " +
          ms +
          " ms<br>HTTP " +
          status;
      }
      var safe = String(nodeName).replace(/[<>&]/g, "");
      var html =
        '<p style="text-align:center;font-family:-apple-system;font-size:large;font-weight:bold">' +
        safe +
        "</p><p style=\"text-align:center;font-family:-apple-system;font-size:large\">" +
        body +
        "</p>";
      $done({ title: "测一下带宽", htmlMessage: html });
    }
  );
}
