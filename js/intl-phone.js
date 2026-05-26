/**
 * 영문 예약용 국제 연락처 입력·검증·저장 형식 (+국가번호 국내번호)
 */
(function (global) {
  var COUNTRIES = [
    { dial: "1", label: "United States / Canada (+1)", min: 10, max: 10, format: formatUsCa },
    { dial: "81", label: "Japan (+81)", min: 9, max: 10, format: formatJp },
    { dial: "86", label: "China (+86)", min: 11, max: 11, format: formatCn },
    { dial: "44", label: "United Kingdom (+44)", min: 10, max: 10, format: formatGrouped4 },
    { dial: "61", label: "Australia (+61)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "49", label: "Germany (+49)", min: 10, max: 11, format: formatGrouped3 },
    { dial: "33", label: "France (+33)", min: 9, max: 9, format: formatGrouped2 },
    { dial: "39", label: "Italy (+39)", min: 9, max: 10, format: formatGrouped3 },
    { dial: "34", label: "Spain (+34)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "31", label: "Netherlands (+31)", min: 9, max: 9, format: formatGrouped2 },
    { dial: "41", label: "Switzerland (+41)", min: 9, max: 9, format: formatGrouped2 },
    { dial: "65", label: "Singapore (+65)", min: 8, max: 8, format: formatGrouped4 },
    { dial: "852", label: "Hong Kong (+852)", min: 8, max: 8, format: formatGrouped4 },
    { dial: "886", label: "Taiwan (+886)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "82", label: "South Korea (+82)", min: 9, max: 10, format: formatKrIntl },
    { dial: "66", label: "Thailand (+66)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "84", label: "Vietnam (+84)", min: 9, max: 10, format: formatGrouped3 },
    { dial: "60", label: "Malaysia (+60)", min: 9, max: 10, format: formatGrouped3 },
    { dial: "63", label: "Philippines (+63)", min: 10, max: 10, format: formatGrouped3 },
    { dial: "62", label: "Indonesia (+62)", min: 9, max: 12, format: formatGrouped3 },
    { dial: "91", label: "India (+91)", min: 10, max: 10, format: formatGrouped5 },
    { dial: "7", label: "Russia (+7)", min: 10, max: 10, format: formatGrouped3 },
    { dial: "971", label: "UAE (+971)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "966", label: "Saudi Arabia (+966)", min: 9, max: 9, format: formatGrouped3 },
    { dial: "55", label: "Brazil (+55)", min: 10, max: 11, format: formatGrouped3 },
    { dial: "52", label: "Mexico (+52)", min: 10, max: 10, format: formatGrouped3 },
    { dial: "64", label: "New Zealand (+64)", min: 8, max: 10, format: formatGrouped3 },
  ];

  function getCountryByDial(dial) {
    var d = String(dial || "").replace(/\D/g, "");
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].dial === d) {
        return COUNTRIES[i];
      }
    }
    return null;
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function stripLeadingZero(nationalDigits) {
    var d = digitsOnly(nationalDigits);
    if (d.length > 1 && d.charAt(0) === "0") {
      return d.replace(/^0+/, "");
    }
    return d;
  }

  function formatUsCa(d) {
    d = d.slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return "(" + d.slice(0, 3) + ") " + d.slice(3);
    return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  }

  function formatJp(d) {
    d = d.slice(0, 10);
    if (d.length <= 2) return d;
    if (d.length <= 6) return d.slice(0, 2) + "-" + d.slice(2);
    return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6);
  }

  function formatCn(d) {
    d = d.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + " " + d.slice(3);
    return d.slice(0, 3) + " " + d.slice(3, 7) + " " + d.slice(7);
  }

  function formatKrIntl(d) {
    d = d.slice(0, 10);
    if (d.length <= 2) return d;
    if (d.length <= 6) return d.slice(0, 2) + "-" + d.slice(2);
    return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6);
  }

  function formatGrouped2(d) {
    d = d.slice(0, 12);
    var out = "";
    for (var i = 0; i < d.length; i += 2) {
      if (out) out += " ";
      out += d.slice(i, i + 2);
    }
    return out;
  }

  function formatGrouped3(d) {
    d = d.slice(0, 12);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + " " + d.slice(3);
    if (d.length <= 9) {
      return d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6);
    }
    return (
      d.slice(0, 3) +
      " " +
      d.slice(3, 6) +
      " " +
      d.slice(6, 9) +
      " " +
      d.slice(9)
    );
  }

  function formatGrouped4(d) {
    d = d.slice(0, 12);
    if (d.length <= 4) return d;
    if (d.length <= 8) return d.slice(0, 4) + " " + d.slice(4);
    return d.slice(0, 4) + " " + d.slice(4, 8) + " " + d.slice(8);
  }

  function formatGrouped5(d) {
    d = d.slice(0, 10);
    if (d.length <= 5) return d;
    return d.slice(0, 5) + " " + d.slice(5);
  }

  function formatNationalDisplay(dial, nationalDigits) {
    var country = getCountryByDial(dial);
    var d = stripLeadingZero(nationalDigits);
    if (!country) {
      return d;
    }
    d = d.slice(0, country.max + 2);
    if (typeof country.format === "function") {
      return country.format(d);
    }
    return formatGrouped3(d);
  }

  function validateNational(dial, nationalDigits) {
    var country = getCountryByDial(dial);
    if (!country) {
      return false;
    }
    var d = stripLeadingZero(nationalDigits);
    return d.length >= country.min && d.length <= country.max;
  }

  function buildStored(dial, nationalInput) {
    var country = getCountryByDial(dial);
    if (!country) {
      return "";
    }
    var national = stripLeadingZero(nationalInput);
    if (!validateNational(dial, national)) {
      return "";
    }
    var display = formatNationalDisplay(dial, national);
    return "+" + country.dial + " " + display;
  }

  function parseStored(stored) {
    var s = String(stored || "").trim();
    if (!s) {
      return { dial: "1", nationalDigits: "", nationalDisplay: "" };
    }
    if (s.charAt(0) === "+") {
      var rest = s.slice(1).trim();
      var dialMatch = rest.match(/^(\d{1,4})\s*(.*)$/);
      if (dialMatch) {
        var dial = dialMatch[1];
        var nationalDigits = digitsOnly(dialMatch[2]);
        return {
          dial: dial,
          nationalDigits: nationalDigits,
          nationalDisplay: formatNationalDisplay(dial, nationalDigits),
        };
      }
    }
    var legacy = digitsOnly(s);
    if (legacy.length === 11 && legacy.indexOf("01") === 0) {
      return {
        dial: "82",
        nationalDigits: legacy.slice(1),
        nationalDisplay: formatKrIntl(legacy.slice(1)),
      };
    }
    return { dial: "1", nationalDigits: legacy, nationalDisplay: s };
  }

  function contactDigitsForMatch(stored) {
    return digitsOnly(String(stored || "").replace(/^\+/, ""));
  }

  function populateDialSelect(selectEl, selectedDial) {
    if (!selectEl) {
      return;
    }
    var sorted = COUNTRIES.slice().sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
    selectEl.innerHTML = "";
    sorted.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.dial;
      opt.textContent = c.label;
      selectEl.appendChild(opt);
    });
    var dial = String(selectedDial || "1").replace(/\D/g, "") || "1";
    if (!getCountryByDial(dial)) {
      dial = "1";
    }
    selectEl.value = dial;
  }

  function bindNationalInput(dialSelect, nationalInput) {
    if (!dialSelect || !nationalInput) {
      return;
    }
    function onInput() {
      var next = formatNationalDisplay(dialSelect.value, nationalInput.value);
      if (nationalInput.value !== next) {
        nationalInput.value = next;
      }
    }
    dialSelect.addEventListener("change", onInput);
    nationalInput.addEventListener("input", onInput);
    nationalInput.addEventListener("blur", onInput);
  }

  global.GraffordIntlPhone = {
    COUNTRIES: COUNTRIES,
    getCountryByDial: getCountryByDial,
    populateDialSelect: populateDialSelect,
    bindNationalInput: bindNationalInput,
    formatNationalDisplay: formatNationalDisplay,
    validateNational: validateNational,
    buildStored: buildStored,
    parseStored: parseStored,
    contactDigitsForMatch: contactDigitsForMatch,
    stripLeadingZero: stripLeadingZero,
    isInternationalStored: function (stored) {
      return String(stored || "").trim().indexOf("+") === 0;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
