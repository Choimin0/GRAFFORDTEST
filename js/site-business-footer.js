/**
 * 하단 사업장 정보 영역을 렌더링합니다.
 * 각 페이지에서 DOMContentLoaded 이후 호출하고, `lines`에 문구를 넣으면 됩니다.
 *
 * @param {Object} [options]
 * @param {string[]} [options.lines=[]] - (레거시) 왼쪽에 표시할 줄 단위 문자열 배열
 * @param {string[]} [options.linesKr=[]] - 한국어 줄 단위 문자열 배열
 * @param {string[]} [options.linesEn=[]] - 영어 줄 단위 문자열 배열
 * @param {{ href: string, imgSrc?: string }} [options.instagram] - 인스타 링크(href). 아이콘은 인라인 SVG로 표시되며 imgSrc는 호환용입니다.
 * @param {string} [options.logoSrc='images/LOGO-circle-transparent.png'] - 오른쪽 로고 이미지 경로
 * @param {string} [options.logoAlt='GRAFFORD'] - 로고 alt 텍스트
 * @param {boolean} [options.naverMapAddress=false] - true이면 `주소 : …` 줄에서 콜론 뒤만 네이버 지도 검색으로 연결
 * @param {string} [options.brandTagline] - 브랜드명 아래 태그라인 (KR/EN 공통 기본값: GROUND · AFFORD · JEJU)
 * @param {string} [options.brandTaglineKr] - 한국어 페이지용 태그라인
 * @param {string} [options.brandTaglineEn] - 영어 페이지용 태그라인
 */

var SITE_LEGAL_MODAL_CONTENT = {
  kr: {
    terms: {
      title: "이용약관",
      bodyHtml:
        "<p>본 약관은 '그라포드(GRAFFORD)'가 제공하는 숙박 예약 서비스의 이용 조건 및 절차, 이용자와 당사의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.</p>" +
        '<h3>제1조 목적</h3><p>이 약관은 그라포드(이하 "사업자")가 운영하는 숙박 예약 관련 웹사이트 및 부대 서비스(이하 "서비스")의 이용과 관련하여 사업자와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>' +
        '<h3>제2조 정의</h3><p>"이용자"란 본 약관에 따라 사업자가 제공하는 서비스를 이용하는 이용자를 말합니다. "예약"이란 이용자가 사업자가 정한 절차에 따라 객실 또는 부대 시설 이용을 신청하는 행위를 말합니다.</p>' +
        "<h3>제3조 약관의 효력 및 변경</h3><p>사업자는 관련 법령을 위배하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시 시행일 및 사유를 서비스 내 공지합니다. 이용자가 개정 약관 시행 후에도 서비스를 계속 이용하는 경우 변경에 동의한 것으로 봅니다. 이용자가 웹사이트에서 예약을 신청하고 결제를 완료함으로써 본 약관에 동의한 것으로 보며, 본 약관은 이용자가 숙박을 완료할 때까지 효력을 가집니다.</p>" +
        "<h3>제4조 서비스의 제공</h3><p>사업자는 예약 안내, 결제 연동, 고객 문의 등 사업자가 정한 범위에서 서비스를 제공합니다. 천재지변, 시스템 점검 등 불가피한 사유가 있는 경우 서비스 제공이 일시 중단될 수 있습니다.</p>" +
        "<h3>제5조 1항 예약 및 결제</h3><p>이용자는 예약 시 정확한 정보를 제공해야 하며, 허위 정보로 인해 발생하는 불이익에 대해 사업자는 책임을 지지 않습니다. 결제·취소·환불 조건은 별도 안내 또는 예약 확정 시 고지되는 정책에 따릅니다.</p>" +
        "<h3>제5조 2항 예약 계약의 성립</h3><p>① 예약 계약은 이용자가 객실 요금 결제를 완료하고, 사업자가 이용자에게 예약 확정 통지(문자, 알림톡, 이메일 등)를 발송하여 이용자에게 도달한 시점에 성립합니다.<br />② 사업자는 만 19세 미만의 미성년자가 보호자의 동반 없이 투숙을 신청하는 경우 예약을 거부하거나 취소할 수 있습니다.</p>" +
        "<h3>제6조 1항 이용자의 의무</h3><p>이용자는 관련 법령, 본 약관, 공지사항을 준수하여야 하며, 타인의 권리를 침해하거나 서비스 운영을 방해하는 행위를 하여서는 안 됩니다.</p>" +
        "<h3>제6조 2항 숙소 이용 규칙 및 이용자의 책임</h3><p>① 이용자는 숙소 내 모든 시설물과 비품을 소중히 다루어야 하며, 이용자의 고의 또는 과실로 인해 시설물·비품이 파손, 오염, 분실된 경우 원상복구 비용 또는 이에 상응하는 손해배상 책임을 집니다.<br />② 숙소 전 구역은 금연(전자담배 포함)이며, 이를 위반하여 객실 내 흡연 적발 시 특수 청소비 및 다음날 객실 판매 불가에 따른 손해배상 비용이 청구될 수 있습니다.<br />③ 예약된 인원 외의 외부인 출입 및 숙박은 엄격히 금지되며, 이를 위반할 경우 사업자는 즉시 퇴실 조치를 취할 수 있으며 이 경우 환불은 불가합니다.<br />④ 고성방가 등 타인에게 심각한 피해를 주는 행위가 지속될 경우 강제 퇴실 조치될 수 있습니다.</p>" +
        "<h3>제7조 면책</h3><p>사업자는 이용자 간 또는 이용자와 제3자 간에 발생한 분쟁에 개입하지 않으며, 사업자의 고의 또는 중대한 과실이 없는 한 일부 손해에 대해 책임을 지지 않을 수 있습니다. 사업자는 숙소 내 시설(자쿠지, 야외 공간 등) 이용 시 이용자의 본인 과실, 음주, 또는 보호자의 아동 관리 소홀로 인해 발생한 안전사고에 대해서는 책임을 지지 않습니다. 이용자의 부주의로 인한 귀중품 분실 및 도난 사고에 대해 사업자는 책임을 지지 않습니다. 본 조는 관련 법령이 정한 한도 내에서 적용됩니다.</p>" +
        "<h3>제8조 준거법 및 관할</h3><p>본 약관과 관련하여 사업자와 이용자 사이에 발생한 분쟁에 관한 소송은 사업자의 소재지를 관할하는 법원을 전속적 관할 법원으로 합니다.</p>",
    },
    privacy: {
      title: "개인정보 처리방침",
      bodyHtml:
        "<p>그라포드(이하 '회사'라 합니다)는 이용자의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 개인정보보호법 제30조에 따라 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>" +
        "<h3>1. 개인정보의 처리 목적, 항목 및 보유 기간</h3><p>회사는 예약 서비스 제공을 위해 필요한 최소한의 개인정보를 수집하고 있습니다. 수집된 개인정보는 고지된 목적 이외의 용도로는 사용되지 않으며, 목적이 달성된 후에는 지체 없이 파기합니다. 단, 관계법령의 규정에 의하여 보존할 필요가 있는 경우 아래와 같이 법정 기간 동안 보관합니다.<br /><br />• 수집 항목: 이름, 연락처(휴대폰 번호), 이메일 주소, 신용카드 결제 정보(카드사명, 승인번호 등 결제 과정에서 발생하는 정보)<br />※ 본 서비스는 회원가입 및 로그인 기능을 제공하지 않는 비회원 전용 시스템으로, 별도의 계정 정보는 수집하지 않습니다.<br />• 처리 목적: 숙소 예약 확인 및 이용 안내, 결제 및 환불 처리, 고객 문의 응대 및 민원 처리<br />• 보유 및 이용 기간:<br />　　◦ 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)<br />　　◦ 대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)<br />　　◦ 소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래 등에서의 소비자보호에 관한 법률)</p>" +
        "<h3>2. 개인정보의 제3자 제공 및 위탁에 관한 사항</h3><p>회사는 원활한 결제 및 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁하고 있으며, 위탁계약 체결 시 개인정보가 안전하게 관리될 수 있도록 필요한 사항을 규정하고 있습니다.<br /><br />• 결제 처리 위탁<br />　　◦ 수탁업체: KG이니시스 (KG Inicis)<br />　　◦ 위탁 업무 내용: 신용카드 및 간편결제 인증, 대금 결제, 환불 대행<br />　　◦ 보유 및 이용 기간: 회원 탈퇴 시 또는 위탁 계약 종료 시까지 (단, 관계 법령에 따른 보존 기간 적용)<br /><br />• 시스템 호스팅 위탁<br />　　◦ 수탁업체: Vercel<br />　　◦ 위탁 업무 내용: 웹사이트 호스팅 및 인프라 관리<br />　　◦ 보유 및 이용 기간: 서비스 이용 종료 시 혹은 위탁 계약 종료 시까지</p>" +
        "<h3>3. 개인정보의 파기절차 및 파기방법</h3><p>회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.<br /><br />• 파기절차: 목적이 달성된 개인정보는 내부 방침 및 관련 법령에 따라 일정 기간 저장된 후 파기됩니다.<br />• 파기방법: 전자적 파일 형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제하며, 종이 문서에 출력된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.</p>" +
        "<h3>4. 이용자의 권리 의무 및 그 행사방법</h3><p>이용자는 회사에 대해 언제든지 개인정보 열람·정정·삭제·처리정지 요구 등의 권리를 행사할 수 있습니다. 권리 행사는 회사에 서면, 이메일 등을 통하여 하실 수 있으며 회사는 이에 대해 지체 없이 조치하겠습니다. (단, 법령에서 보존 의무를 규정한 경우 삭제가 제한될 수 있습니다.)</p>" +
        "<h3>5. 개인정보의 안전성 확보 조치</h3><p>회사는 이용자의 개인정보를 취급함에 있어 분실·도난·유출·변조 또는 훼손되지 않도록 다음과 같은 기술적·관리적 대책을 강구하고 있습니다.<br /><br />• 개인정보 암호화: 이용자의 개인정보는 암호화되어 저장 및 관리되고 있으며, 중요한 데이터는 전송 시 암호화 구간을 거치는 등 별도의 보안 기능을 사용하고 있습니다.<br />• 해킹 등에 대비한 대책: 해킹이나 컴퓨터 바이러스 등에 의해 이용자의 개인정보가 유출되거나 훼손되는 것을 막기 위해 최신 보안 프로그램을 설치하고 주기적인 업데이트를 수행하고 있습니다.</p>" +
        "<h3>6. 개인정보 보호책임자</h3><p>회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 이용자의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.<br /><br />• 개인정보 보호책임자<br />　　◦ 성명 : 최민영<br />　　◦ 연락처 : 010-6630-7297<br />　　◦ 이메일 : tilkoas35@naver.com</p>" +
        "<h3>7. 개인정보 처리방침 변경에 관한 사항</h3><p>이 개인정보 처리방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경내용의 추가, 삭제 및 정정이 있는 경우에는 변경사항의 시행 7일 전부터 공지사항을 통해 고지할 것입니다.<br /><br />• 공고일자: 2026년 [월] [일]<br />• 시행일자: 2026년 [월] [일]</p>",
    },
  },
  en: {
    terms: {
      title: "Terms of Use",
      bodyHtml:
        "<p>These Terms and Conditions are intended to set forth the terms and procedures for use of the accommodation reservation services provided by GRAFFORD, and the rights, obligations, and responsibilities of users and the Company.</p>" +
        '<h3>Article 1 (Purpose)</h3><p>These Terms and Conditions govern the rights, obligations, and responsibilities between the business operator and the user in connection with the use of the website for accommodation reservations and ancillary services (hereinafter referred to as the "Service") operated by Grafford (hereinafter referred to as the "Business Operator").</p>' +
        '<h3>Article 2 (Definitions)</h3><p>"User" means a user who uses the services provided by the Business Operator in accordance with these Terms and Conditions. "Reservation" means the act of a user applying for use of a guest room or ancillary facilities in accordance with the procedures established by the Business Operator.</p>' +
        "<h3>Article 3 (Effectiveness of and Changes to the Terms)</h3><p>The Business Operator may revise these Terms and Conditions to the extent not inconsistent with applicable laws and regulations, and upon revision will announce the effective date and reasons within the Service. If a user continues to use the Service after the revised Terms take effect, the user shall be deemed to have agreed to the changes. When a user applies for a reservation on the website and completes payment, the user shall be deemed to have agreed to these Terms and Conditions, and these Terms shall remain in effect until the user completes their stay.</p>" +
        "<h3>Article 4 (Provision of Services)</h3><p>The Business Operator shall provide the Service within the scope it determines, including reservation guidance, payment integration, and customer inquiries. The Service may be temporarily suspended due to force majeure such as natural disasters or system maintenance.</p>" +
        "<h3>Article 5 (1) Reservations and Payment</h3><p>The User must provide accurate information at the time of reservation, and the Business Operator assumes no responsibility for disadvantages arising from false information. Payment, cancellation, and refund conditions shall follow the policies separately provided or notified at the time the reservation is confirmed.</p>" +
        "<h3>Article 5 (2) Formation of the Reservation Contract</h3><p>① The reservation contract is formed when the User completes payment of the room rate and the Business Operator sends the User a reservation confirmation notice (by text message, Kakao notification message, email, etc.) and it reaches the User.<br />② If a minor under 19 years of age applies to stay without being accompanied by a parent or legal guardian, the Business Operator may refuse or cancel the reservation.</p>" +
        "<h3>Article 6 (1) User Obligations</h3><p>The User shall comply with applicable laws and regulations, these Terms and Conditions, and notices published by the Business Operator, and shall not engage in conduct that infringes the rights of others or interferes with the operation of the Service.</p>" +
        "<h3>Article 6 (2) Accommodation Rules and User Responsibility</h3><p>① The User shall treat all facilities and furnishings within the accommodation with care, and if facilities or furnishings are damaged, soiled, or lost due to the User&#39;s intent or negligence, the User shall be liable for restoration costs or equivalent damages.<br />② The entire accommodation is non-smoking (including e-cigarettes), and if smoking is detected in a guest room in violation of this rule, special cleaning charges and compensation for damages due to inability to sell the room the following day may be charged.<br />③ Entry and overnight stay by persons other than the number of guests reserved are strictly prohibited, and in the event of a violation the Business Operator may immediately require the guest to vacate the premises, in which case no refund shall be given.<br />④ If conduct causing serious harm to others, such as excessive noise, persists, the guest may be subject to compulsory eviction.</p>" +
        "<h3>Article 7 (Disclaimer)</h3><p>The Business Operator shall not intervene in disputes between users or between a user and a third party, and may not be liable for certain damages absent the Business Operator&#39;s willful misconduct or gross negligence. The Business Operator shall not be liable for safety accidents occurring during use of facilities within the accommodation (such as jacuzzis or outdoor areas) due to the User&#39;s own fault, intoxication, or inadequate supervision of children by guardians. The Business Operator shall not be liable for loss or theft of valuables due to the User&#39;s negligence. This Article shall apply to the extent permitted by applicable laws and regulations.</p>" +
        "<h3>Article 8 (Governing Law and Jurisdiction)</h3><p>Lawsuits concerning disputes arising between the Business Operator and the User in connection with these Terms shall be under the exclusive jurisdiction of the courts having jurisdiction over the Business Operator&#39;s principal place of business.</p>",
    },
    privacy: {
      title: "Privacy Policy",
      bodyHtml:
        '<p>GRAFFORD (hereinafter referred to as the "Company") establishes and discloses the following Privacy Policy pursuant to Article 30 of the Personal Information Protection Act in order to protect users&#39; personal information and to handle related complaints promptly and smoothly.</p>' +
        "<h3>1. Purposes of Processing, Items of Personal Information, and Retention Periods</h3><p>The Company collects only the minimum personal information necessary to provide reservation services. Collected personal information is not used for purposes other than those disclosed, and is destroyed without delay once the purposes have been achieved. Provided, however, that where retention is required under applicable laws and regulations, the information shall be stored for the statutory periods below.<br /><br />• Items collected: name, contact information (mobile phone number), email address, credit card payment information (information generated in the payment process, such as card issuer name and approval number)<br />※ As this Service is a non-member-only system that does not provide membership registration or login features, no separate account information is collected.<br />• Purposes of processing: accommodation reservation confirmation and usage guidance, payment and refund processing, customer inquiry and complaint handling<br />• Retention and use periods:<br />　　◦ Records concerning contracts or withdrawal of offers: 5 years (Act on the Consumer Protection in Electronic Commerce, etc.)<br />　　◦ Records concerning payment and supply of goods, etc.: 5 years (Act on the Consumer Protection in Electronic Commerce, etc.)<br />　　◦ Records concerning consumer complaints or dispute resolution: 3 years (Act on the Consumer Protection in Electronic Commerce, etc.)</p>" +
        "<h3>2. Third-Party Provision and Entrustment of Personal Information</h3><p>For smooth payment processing and service provision, the Company entrusts the processing of personal information as set forth below, and upon execution of entrustment agreements stipulates necessary matters so that personal information can be managed securely.<br /><br />• Payment processing entrustment<br />　　◦ Entrusted company: KG Inicis (KG이니시스)<br />　　◦ Scope of entrusted work: credit card and easy-pay authentication, payment and collection, and refund agency<br />　　◦ Retention and use period: until membership withdrawal or termination of the entrustment agreement (provided that statutory retention periods apply where required by law)<br /><br />• System hosting entrustment<br />　　◦ Entrusted company: Vercel<br />　　◦ Scope of entrusted work: website hosting and infrastructure management<br />　　◦ Retention and use period: until the end of use of the service or termination of the entrustment agreement</p>" +
        "<h3>3. Procedures and Methods for Destruction of Personal Information</h3><p>When personal information becomes unnecessary due to expiration of the retention period, achievement of the purposes of processing, or otherwise, the Company destroys the relevant personal information without delay.<br /><br />• Destruction procedure: Personal information for which the purposes have been achieved is stored for a certain period in accordance with internal policies and applicable laws and regulations, and then destroyed.<br />• Destruction method: Personal information stored in electronic file form is deleted using technical methods that make records irreproducible, and personal information printed on paper is shredded or incinerated for destruction.</p>" +
        "<h3>4. Users&#39; Rights and Obligations and How to Exercise Them</h3><p>Users may at any time request access to, correction of, deletion of, or suspension of processing of personal information held by the Company. Such requests may be made in writing or by email to the Company, which will respond without delay. (Provided, however, that deletion may be restricted where laws require retention.)</p>" +
        "<h3>5. Measures to Ensure Security of Personal Information</h3><p>In handling users&#39; personal information, the Company implements the following technical and administrative safeguards to prevent loss, theft, leakage, alteration, or damage.<br /><br />• Encryption of personal information: Users&#39; personal information is stored and managed in encrypted form, and for important data, separate security features such as encrypted channels during transmission are used.<br />• Measures against hacking, etc.: To prevent leakage or damage to users&#39; personal information due to hacking or computer viruses, the Company installs up-to-date security software and conducts periodic updates.</p>" +
        "<h3>6. Privacy Officer</h3><p>The Company designates the following privacy officer to oversee personal information processing and to handle users&#39; complaints and damage relief.<br /><br />• Privacy Officer<br />　　◦ Name: Choi Minyoung<br />　　◦ Contact: 010-6630-7297<br />　　◦ Email: tilkoas35@naver.com</p>" +
        "<h3>7. Changes to This Privacy Policy</h3><p>This Privacy Policy applies from its effective date, and if additions, deletions, or corrections are made due to changes in laws or policies, such changes will be announced through notices at least 7 days before they take effect.<br /><br />• Date of announcement: [Month] [Day], 2026<br />• Effective date: [Month] [Day], 2026</p>",
    },
  },
};

function resolveFooterLanguage() {
  if (
    window.GraffordLanguage &&
    typeof window.GraffordLanguage.getCurrentLanguage === "function"
  ) {
    return window.GraffordLanguage.getCurrentLanguage();
  }
  return "kr";
}

function buildFooterLegalButtonsHtml(language) {
  var isEn = language === "en";
  var termsLabel = isEn ? "Terms of Use" : "이용약관";
  var privacyLabel = isEn ? "Privacy Policy" : "개인정보 처리방침";
  return (
    '<button type="button" class="site-business-footer__legal-btn" data-site-legal-open="terms">' +
    termsLabel +
    "</button>" +
    '<button type="button" class="site-business-footer__legal-btn site-business-footer__legal-btn--privacy" data-site-legal-open="privacy">' +
    privacyLabel +
    "</button>"
  );
}

function businessRegNoDigits(value) {
  return String(value).replace(/\D/g, "");
}

function ftcBizCommPopUrl(regNo) {
  var digits = businessRegNoDigits(regNo);
  if (!digits) {
    return null;
  }
  return "https://www.ftc.go.kr/bizCommPop.do?wrkr_no=" + digits;
}

function findTelcoSalesReportRowIndex(infoRows) {
  for (var k = infoRows.length - 1; k >= 0; k--) {
    if (infoRows[k].labelKey === "telcoSalesReport") {
      return k;
    }
  }
  return -1;
}

function findBusinessInfoRowIndex(infoRows) {
  for (var j = infoRows.length - 1; j >= 0; j--) {
    if (
      infoRows[j].label === "사업자" ||
      infoRows[j].label === "Business no."
    ) {
      return j;
    }
  }
  return -1;
}

function upsertTelcoSalesReportRow(infoRows, value, label) {
  var resolvedLabel = label || "통신판매업신고번호";
  var existingIdx = findTelcoSalesReportRowIndex(infoRows);
  if (existingIdx >= 0) {
    infoRows[existingIdx].value = value;
    infoRows[existingIdx].label = resolvedLabel;
    var businessIdx = findBusinessInfoRowIndex(infoRows);
    if (businessIdx >= 0 && existingIdx !== businessIdx + 1) {
      var row = infoRows.splice(existingIdx, 1)[0];
      infoRows.splice(businessIdx + 1, 0, row);
    }
    return;
  }

  var insertAt = infoRows.length;
  var businessRowIdx = findBusinessInfoRowIndex(infoRows);
  if (businessRowIdx >= 0) {
    insertAt = businessRowIdx + 1;
  }

  infoRows.splice(insertAt, 0, {
    labelKey: "telcoSalesReport",
    label: resolvedLabel,
    value: value,
    mapHref: null,
  });
}

function naverMapSearchUrl(query) {
  return (
    "https://map.naver.com/v5/search/" +
    encodeURIComponent(String(query).trim())
  );
}

function parseBusinessFooterLines(selectedLines, language, naverMapAddr) {
  var infoRows = [];
  var copyrightLine = null;
  var ownerNameKr = "서동옥";

  for (var i = 0; i < selectedLines.length; i++) {
    var raw = selectedLines[i];
    if (raw == null) {
      continue;
    }
    var lineStr = String(raw);
    if (lineStr === " ") {
      continue;
    }
    if (String(lineStr).trim() === "") {
      continue;
    }
    if (/©/.test(lineStr)) {
      copyrightLine = lineStr.trim();
      continue;
    }

    var trimmed = lineStr.trim();
    var m;
    var treatAsKr = /[가-힣]/.test(trimmed);

    if (treatAsKr || language !== "en") {
      m = /^대표\s*:\s*(.+)$/.exec(trimmed);
      if (m) {
        infoRows.push({ label: "대표", value: m[1].trim(), mapHref: null });
        infoRows.push({
          label: "대표자",
          value: ownerNameKr,
          mapHref: null,
        });
        continue;
      }
      m = /^주소\s*:\s*(.+)$/.exec(trimmed);
      if (m) {
        var addrKr = m[1].trim();
        infoRows.push({
          label: "주소",
          value: addrKr,
          mapHref: naverMapAddr ? naverMapSearchUrl(addrKr) : null,
        });
        continue;
      }
      m = /^통신판매업신고번호\s*:\s*(.*)$/.exec(trimmed);
      if (m) {
        upsertTelcoSalesReportRow(infoRows, m[1].trim());
        continue;
      }
      m = /^사업자등록번호\s*:\s*(.+)$/.exec(trimmed);
      if (m) {
        var regNoKr = m[1].trim();
        infoRows.push({
          label: "사업자",
          value: regNoKr,
          mapHref: null,
          ftcHref: ftcBizCommPopUrl(regNoKr),
        });
        upsertTelcoSalesReportRow(infoRows, "", "통신판매업신고번호");
        continue;
      }

      m = /^전화\s*:\s*(.+)$/.exec(trimmed);
      if (m) {
        infoRows.push({ label: "전화", value: m[1].trim(), mapHref: null });
        continue;
      }
      m = /^이메일\s*:\s*(.+)$/.exec(trimmed);
      if (m) {
        infoRows.push({ label: "이메일", value: m[1].trim(), mapHref: null });
        continue;
      }
    }

    m = /^(Representative|CEO)\s*:\s*(.+)$/i.exec(trimmed);
    if (m) {
      infoRows.push({
        label: "Representative",
        value: m[2].trim(),
        mapHref: null,
      });
      continue;
    }
    m = /^Address\s*:\s*(.+)$/i.exec(trimmed);
    if (m) {
      var addrEn = m[1].trim();
      infoRows.push({
        label: "Address",
        value: addrEn,
        mapHref: naverMapAddr ? naverMapSearchUrl(addrEn) : null,
      });
      continue;
    }
    m =
      /^(Mail-order business report(?:\s+no\.?)?|E-commerce registration(?:\s+no\.?)?)\s*:\s*(.*)$/i.exec(
        trimmed,
      );
    if (m) {
      upsertTelcoSalesReportRow(
        infoRows,
        m[2].trim(),
        "Mail-order business report no.",
      );
      continue;
    }
    m =
      /^(Business registration(?:\s+number)?|Business no\.)\s*:\s*(.+)$/i.exec(
        trimmed,
      );
    if (m) {
      var regNoEn = m[2].trim();
      infoRows.push({
        label: "Business no.",
        value: regNoEn,
        mapHref: null,
        ftcHref: ftcBizCommPopUrl(regNoEn),
      });
      upsertTelcoSalesReportRow(infoRows, "", "Mail-order business report no.");
      continue;
    }
    m = /^(Phone|Tel)\s*:\s*(.+)$/i.exec(trimmed);
    if (m) {
      infoRows.push({ label: "Phone", value: m[2].trim(), mapHref: null });
      continue;
    }
    m = /^Email\s*:\s*(.+)$/i.exec(trimmed);
    if (m) {
      infoRows.push({ label: "Email", value: m[1].trim(), mapHref: null });
      continue;
    }
  }

  return { infoRows: infoRows, copyrightLine: copyrightLine };
}

function buildFooterInfoGridHtml(rows, escapeHtmlFn) {
  if (!rows.length) {
    return "";
  }
  var parts = ['<dl class="site-business-footer__info-grid">'];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    parts.push("<dt>" + escapeHtmlFn(r.label) + "</dt><dd>");
    if (r.mapHref) {
      parts.push(
        '<a class="site-business-footer__info-value-link" href="' +
          escapeHtmlFn(r.mapHref) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtmlFn(r.value) +
          "</a>",
      );
    } else if (r.value) {
      if (r.ftcHref) {
        parts.push(
          '<a class="site-business-footer__biz-reg-no" href="' +
            escapeHtmlFn(r.ftcHref) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtmlFn(r.value) +
            "</a>",
        );
      } else {
        parts.push(escapeHtmlFn(r.value));
      }
    } else if (r.labelKey === "telcoSalesReport") {
      parts.push(
        '<span class="site-business-footer__info-placeholder"></span>',
      );
    }
    parts.push("</dd>");
  }
  parts.push("</dl>");
  return parts.join("");
}

function ensureSiteLegalModal() {
  if (document.getElementById("site-legal-modal")) {
    return;
  }
  var wrap = document.createElement("div");
  wrap.id = "site-legal-modal";
  wrap.className = "site-legal-modal";
  wrap.setAttribute("hidden", "");
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="site-legal-modal__backdrop" aria-hidden="true"></div>' +
    '<div class="site-legal-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="site-legal-modal-title">' +
    '<div class="site-legal-modal__header">' +
    '<div class="site-legal-modal__header-copy">' +
    '<p class="site-legal-modal__eyebrow"></p>' +
    '<h2 id="site-legal-modal-title" class="site-legal-modal__title"></h2>' +
    "</div>" +
    '<button type="button" class="site-legal-modal__close" aria-label="닫기">X</button>' +
    "</div>" +
    '<div class="site-legal-modal__body"></div>' +
    '<div class="site-legal-modal__footer">' +
    '<p class="site-legal-modal__notice"></p>' +
    '<button type="button" class="btn reserve-btn confirm-pay-submit reserveinfo-submit-btn site-legal-modal__confirm"></button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(wrap);

  var titleEl = wrap.querySelector("#site-legal-modal-title");
  var eyebrowEl = wrap.querySelector(".site-legal-modal__eyebrow");
  var bodyEl = wrap.querySelector(".site-legal-modal__body");
  var closeBtn = wrap.querySelector(".site-legal-modal__close");
  var noticeEl = wrap.querySelector(".site-legal-modal__notice");
  var confirmBtn = wrap.querySelector(".site-legal-modal__confirm");

  function currentLang() {
    return resolveFooterLanguage() === "en" ? "en" : "kr";
  }

  function closeModal() {
    wrap.setAttribute("hidden", "");
    wrap.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (closeBtn) {
      closeBtn.setAttribute(
        "aria-label",
        currentLang() === "en" ? "Close" : "닫기",
      );
    }
  }

  function decorateLegalBody() {
    if (!bodyEl) {
      return;
    }
    var headings = bodyEl.querySelectorAll("h3");
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var title = heading.textContent.trim();
      var sectionNo = String(i + 1);
      if (sectionNo.length < 2) {
        sectionNo = "0" + sectionNo;
      }
      heading.textContent = "";

      var kicker = document.createElement("span");
      kicker.className = "site-legal-modal__section-kicker";
      kicker.textContent = "ART. " + sectionNo;

      var rule = document.createElement("span");
      rule.className = "site-legal-modal__section-rule";
      rule.setAttribute("aria-hidden", "true");

      var titleEl = document.createElement("span");
      titleEl.className = "site-legal-modal__section-title";
      titleEl.textContent = title;

      heading.appendChild(kicker);
      heading.appendChild(rule);
      heading.appendChild(titleEl);
    }
  }

  function openModal(kind) {
    var lang = currentLang();
    var pack = SITE_LEGAL_MODAL_CONTENT[lang] || SITE_LEGAL_MODAL_CONTENT.kr;
    var entry = pack[kind];
    if (!entry) {
      return;
    }
    if (titleEl) {
      titleEl.textContent = entry.title;
    }
    if (eyebrowEl) {
      eyebrowEl.textContent =
        kind === "privacy" ? "PRIVACY POLICY" : "TERMS OF SERVICE";
    }
    if (bodyEl) {
      bodyEl.innerHTML = entry.bodyHtml;
      decorateLegalBody();
      bodyEl.scrollTop = 0;
    }
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", lang === "en" ? "Close" : "닫기");
    }
    if (noticeEl) {
      noticeEl.textContent =
        lang === "en"
          ? "By completing a reservation, you are deemed to have agreed to this notice."
          : "예약 완료 시 본 안내에 동의한 것으로 간주됩니다.";
    }
    if (confirmBtn) {
      confirmBtn.textContent = lang === "en" ? "I Understand" : "확인했습니다";
    }
    wrap.removeAttribute("hidden");
    wrap.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (bodyEl) {
      window.requestAnimationFrame(function () {
        bodyEl.scrollTop = 0;
      });
    }
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  document.addEventListener("click", function (event) {
    var opener =
      event.target && event.target.closest
        ? event.target.closest("[data-site-legal-open]")
        : null;
    if (!opener) {
      return;
    }
    event.preventDefault();
    var k = opener.getAttribute("data-site-legal-open");
    if (k === "terms" || k === "privacy") {
      openModal(k);
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeModal();
    });
  }
  if (confirmBtn) {
    confirmBtn.addEventListener("click", function () {
      closeModal();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !wrap.hasAttribute("hidden")) {
      closeModal();
    }
  });
}

function initSiteBusinessFooter(options) {
  ensureSiteLegalModal();

  var roots = Array.prototype.slice.call(
    document.querySelectorAll("[data-site-business-footer-mount]"),
  );
  if (!roots.length) {
    var legacyRoot = document.getElementById("site-business-footer-mount");
    if (legacyRoot) {
      roots.push(legacyRoot);
    }
  }
  if (!roots.length) {
    return;
  }

  options = options || {};
  var lines = options.lines;
  var linesKr = options.linesKr;
  var linesEn = options.linesEn;
  if (!Array.isArray(linesKr)) {
    linesKr = Array.isArray(lines) ? lines : [];
  }
  if (!Array.isArray(linesEn)) {
    linesEn = [];
  }

  var logoSrc =
    options.logoSrc ||
    (window.getGraffordSharedImage &&
      window.getGraffordSharedImage(
        "js/site-business-footer.js",
        "defaultFooterLogo",
      )) ||
    "images/LOGO-circle-transparent.png";
  var logoAlt = options.logoAlt || "GRAFFORD";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var instaCfg = options.instagram;

  var naverMapAddr = options.naverMapAddress === true;

  function renderByLanguage(language) {
    var selectedLines = language === "en" ? linesEn : linesKr;
    if (!Array.isArray(selectedLines) || selectedLines.length === 0) {
      selectedLines = linesKr;
    }

    var parsed = parseBusinessFooterLines(
      selectedLines,
      language,
      naverMapAddr,
    );
    var infoGridHtml = buildFooterInfoGridHtml(parsed.infoRows, escapeHtml);
    var copyrightText =
      parsed.copyrightLine || "© 2026 GRAFFORD. all rights reserved.";

    var tagline =
      (language === "en" ? options.brandTaglineEn : options.brandTaglineKr) ||
      options.brandTagline ||
      "GROUND · AFFORD · JEJU";

    var instaRow = "";
    if (instaCfg && instaCfg.href) {
      var instaHref = String(instaCfg.href).trim();
      var instaSvg =
        '<svg class="site-business-footer__ig-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>' +
        '<circle cx="12" cy="12" r="4"></circle>' +
        '<circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"></circle>' +
        "</svg>";
      instaRow =
        '<a class="site-business-footer__instagram-row" href="' +
        escapeHtml(instaHref) +
        '" target="_blank" rel="noopener noreferrer">' +
        instaSvg +
        '<span class="site-business-footer__instagram-label">INSTAGRAM</span>' +
        "</a>";
    }

    var legalNav =
      '<nav class="site-business-footer__legal-nav" aria-label="' +
      escapeHtml(language === "en" ? "Legal" : "법적 고지") +
      '">' +
      buildFooterLegalButtonsHtml(language) +
      "</nav>";

    var shellHtml =
      '<div class="site-business-footer__shell">' +
      '<div class="site-business-footer__grid">' +
      '<div class="site-business-footer__col site-business-footer__col--brand">' +
      '<span class="site-business-footer__brand-name">GRAFFORD</span>' +
      '<p class="site-business-footer__brand-tagline">' +
      escapeHtml(tagline) +
      "</p>" +
      instaRow +
      "</div>" +
      '<div class="site-business-footer__divider" aria-hidden="true"></div>' +
      '<div class="site-business-footer__col site-business-footer__col--info">' +
      infoGridHtml +
      "</div>" +
      '<div class="site-business-footer__divider" aria-hidden="true"></div>' +
      '<div class="site-business-footer__col site-business-footer__col--logo">' +
      '<img class="site-business-footer__logo" src="' +
      escapeHtml(logoSrc) +
      '" alt="' +
      escapeHtml(logoAlt) +
      '" decoding="async" />' +
      "</div>" +
      "</div>" +
      '<div class="site-business-footer__bottom">' +
      '<p class="site-business-footer__copyright">' +
      escapeHtml(copyrightText) +
      "</p>" +
      legalNav +
      "</div>" +
      '<div class="site-business-footer__gold-line" aria-hidden="true"></div>' +
      "</div>";

    roots.forEach(function (root) {
      root.className = "site-footer site-business-footer";
      root.innerHTML = shellHtml;
      root.hidden = false;
    });
  }

  renderByLanguage(resolveFooterLanguage());
  document.addEventListener("grafford:languagechange", function (event) {
    var nextLanguage =
      event && event.detail && event.detail.language
        ? event.detail.language
        : resolveFooterLanguage();
    renderByLanguage(nextLanguage);
  });
}

window.initSiteBusinessFooter = initSiteBusinessFooter;
