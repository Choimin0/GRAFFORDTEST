export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  var storeId = process.env.STORE_ID || "";
  var channelKey = process.env.CHANNEL_KEY || "";
  var naverPayChannelKey = process.env.NAVER_PAY_CHANNEL_KEY || "";

  if (!storeId || !channelKey) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error:
          "STORE_ID 또는 CHANNEL_KEY 환경변수가 설정되지 않았습니다.",
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      storeId: storeId,
      channelKey: channelKey,           // 신용카드 채널 키
      naverPayChannelKey: naverPayChannelKey, // 네이버페이 채널 키
    }),
  );
}
