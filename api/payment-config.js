export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  var storeId = process.env.STORE_ID || "";
  var channelKey = process.env.CHANNEL_KEY || "";

  if (!storeId || !channelKey) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "STORE_ID 또는 CHANNEL_KEY 환경변수가 설정되지 않았습니다.",
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ storeId: storeId, channelKey: channelKey }));
}
