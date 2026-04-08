import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const location = url.searchParams.get("location") ?? "";

  if (error) {
    return new NextResponse(
      `<html><body style="font-family: sans-serif; padding: 24px;">
        <h2>Zoho 授權失敗</h2>
        <p>error: <code>${error}</code></p>
      </body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  return new NextResponse(
    `<!doctype html>
<html>
<body style="font-family: sans-serif; padding: 24px;">
  <h2>Zoho 授權成功</h2>
  <p>已收到授權碼，請複製下面內容貼回給我：</p>
  <pre id="result" style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap;">code=${code}
location=${location}</pre>
  <p style="margin-top:12px;">
    <a id="exchange-link" href="#" style="color:#1d76c2;text-decoration:underline;">一鍵交換 token（開 JSON）</a>
  </p>
  <script>
    (function () {
      var text = document.getElementById("result");
      var link = document.getElementById("exchange-link");
      if (!text) return;
      var code = ${JSON.stringify(code)};
      var location = ${JSON.stringify(location)};
      var hash = window.location.hash || "";
      if ((!code || !location) && hash.startsWith("#")) {
        var h = new URLSearchParams(hash.slice(1));
        code = code || h.get("code") || "";
        location = location || h.get("location") || "";
      }
      text.textContent = "code=" + code + "\\nlocation=" + location;
      if (link && code) {
        link.setAttribute("href", "/api/zoho/exchange-code?code=" + encodeURIComponent(code));
      }
    })();
  </script>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
