/**
 * Admin: 기간별 요금 옵션 (seasonal room rates)
 */
(function (root) {
  var ROOMS = ["G1", "G2", "G3", "G4"];
  var MONTH_NAMES = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];

  var seasonalRates = [];
  var calView = new Date();
  calView.setDate(1);
  var calRangeStart = "";
  var calRangeEnd = "";
  var editingId = null;
  var pendingDeleteId = null;
  var PENCIL_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.08H5v-.92l9.06-9.06.92.92L5.92 19.33zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>';

  var deps = {
    adminPost: null,
    getAuthPayload: null,
    formatKRW: null,
    escapeHtml: null,
    getTodayYmdKst: null,
    showMessage: null,
    getChargeRow: null,
    isWeekendSurchargeEnabled: null,
    getWeekendChargeAmount: null,
    getRoomWeekendRateFromRow: null,
    roomRateRows: function () {
      return [];
    },
    policyConfirmModal: null,
    setPolicyConfirmTitle: null,
    setPolicyConfirmSaveLabel: null,
    closePolicyConfirm: null,
    onPolicyConfirmSave: null,
  };

  function isSurchargeEnabled() {
    return typeof deps.isWeekendSurchargeEnabled === "function"
      ? deps.isWeekendSurchargeEnabled()
      : true;
  }

  function getWeekendChargeAmount() {
    return typeof deps.getWeekendChargeAmount === "function"
      ? deps.getWeekendChargeAmount()
      : 20000;
  }

  function resolveWeekendRate(weekdayRate, weekendRate) {
    var weekday = Number(weekdayRate || 0);
    if (isSurchargeEnabled()) {
      return weekday + getWeekendChargeAmount();
    }
    return Number(weekendRate || 0);
  }

  function syncWeekendFieldMode(rootEl) {
    rootEl = rootEl || document;
    var surchargeEnabled = isSurchargeEnabled();
    ["admin-seasonal-weekend-field", "admin-seasonal-edit-weekend-field"].forEach(
      function (fieldId) {
        var field = rootEl.getElementById
          ? rootEl.getElementById(fieldId)
          : document.getElementById(fieldId);
        if (!field) {
          return;
        }
        field.hidden = surchargeEnabled;
      },
    );
  }

  function formatPeriodLabel(startDate, endDate) {
    function dot(ymd) {
      var p = String(ymd || "").split("-");
      if (p.length !== 3) {
        return ymd || "";
      }
      return p[0] + "." + Number(p[1]) + "." + Number(p[2]);
    }
    return dot(startDate) + " - " + dot(endDate);
  }

  function parseRateValue(raw) {
    return Number(String(raw || "").replace(/[^\d]/g, ""));
  }


  function renderActiveCriteria() {
    var el = document.getElementById("admin-room-rate-active-criteria");
    if (!el) {
      return;
    }
    var surchargeEnabled =
      typeof deps.isWeekendSurchargeEnabled === "function"
        ? deps.isWeekendSurchargeEnabled()
        : true;
    var weekendCharge =
      typeof deps.getWeekendChargeAmount === "function"
        ? deps.getWeekendChargeAmount()
        : 20000;
    var today =
      typeof deps.getTodayYmdKst === "function"
        ? deps.getTodayYmdKst()
        : "";
    var P = root.GraffordBookingPricing;
    var rows = typeof deps.roomRateRows === "function" ? deps.roomRateRows() : [];
    var roomBits = ROOMS.map(function (room) {
      var row = rows.filter(function (r) {
        return r && r.roomName === room;
      })[0];
      var weekday = Number((row && row.weekdayBaseRate) || 0);
      var weekend =
        row && typeof deps.getRoomWeekendRateFromRow === "function"
          ? deps.getRoomWeekendRateFromRow(
              row,
              weekday,
              weekendCharge,
            )
          : weekday + weekendCharge;
      var source = "기본 요금";
      if (P && typeof P.getEffectiveRatesForDate === "function" && today) {
        var effective = P.getEffectiveRatesForDate(room, today);
        if (effective && effective.source === "seasonal") {
          weekday = effective.weekday;
          weekend = effective.weekend;
          source = "기간별 요금";
        }
      }
      return (
        "<div class='admin-room-rate-active-item'>" +
        "<span class='admin-room-rate-active-item__room'>" +
        deps.escapeHtml(room) +
        "</span>" +
        "<span class='admin-room-rate-active-item__rates'>" +
        "평일 " +
        deps.formatKRW(weekday) +
        " · 주말 " +
        deps.formatKRW(weekend) +
        "</span>" +
        "<span class='admin-room-rate-active-item__source'>" +
        deps.escapeHtml(source) +
        "</span>" +
        "</div>"
      );
    }).join("");
    el.innerHTML =
      "<div class='admin-room-rate-active-criteria__head'>" +
      "<p class='admin-dashboard-eyebrow'>ACTIVE RATE</p>" +
      "<h3>현재 적용중인 객실 요금 기준</h3>" +
      "</div>" +
      "<p class='admin-room-rate-active-criteria__rule'>" +
      (surchargeEnabled
        ? "주말 요금: 금·토 · 주말 추가요금 ON (" +
          deps.formatKRW(weekendCharge) +
          ")"
        : "주말 요금: 금·토 · 객실별 주말 요금 직접 설정") +
      "</p>" +
      "<div class='admin-room-rate-active-grid'>" +
      roomBits +
      "</div>";
  }

  function sortSeasonalRates(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var roomA = ROOMS.indexOf(String(a.roomName || "").toUpperCase());
      var roomB = ROOMS.indexOf(String(b.roomName || "").toUpperCase());
      if (roomA !== roomB) {
        return (roomA < 0 ? 99 : roomA) - (roomB < 0 ? 99 : roomB);
      }
      var ua = String(a.updatedAt || a.createdAt || "");
      var ub = String(b.updatedAt || b.createdAt || "");
      if (ua !== ub) {
        return ub.localeCompare(ua);
      }
      return Number(b.id || 0) - Number(a.id || 0);
    });
  }

  function renderSeasonalList() {
    var listEl = document.getElementById("admin-seasonal-rate-list");
    if (!listEl) {
      return;
    }
    if (!seasonalRates.length) {
      listEl.innerHTML =
        "<p class='admin-seasonal-rate-empty'>등록된 기간별 요금 옵션이 없습니다.</p>";
      return;
    }
    var header =
      "<div class='admin-seasonal-rate-row admin-seasonal-rate-row--head'>" +
      "<span>객실</span>" +
      "<span>기간</span>" +
      "<span>옵션 이름</span>" +
      "<span class='admin-seasonal-rate-head-price'><small>평일</small><strong>요금</strong></span>" +
      "<span class='admin-seasonal-rate-head-price'><small>주말</small><strong>요금</strong></span>" +
      "<span></span>" +
      "</div>";
    var rows = sortSeasonalRates(seasonalRates)
      .map(function (row) {
        return (
          "<div class='admin-seasonal-rate-row' data-seasonal-id='" +
          String(row.id) +
          "'>" +
          "<span class='admin-seasonal-rate-room'>" +
          deps.escapeHtml(row.roomName) +
          "</span>" +
          "<span class='admin-seasonal-rate-period'>" +
          deps.escapeHtml(formatPeriodLabel(row.startDate, row.endDate)) +
          "</span>" +
          "<span class='admin-seasonal-rate-name'>" +
          deps.escapeHtml(row.optionName || "—") +
          "</span>" +
          "<span class='admin-seasonal-rate-price'>" +
          "<small>평일</small>" +
          "<strong>" +
          deps.formatKRW(row.weekdayBaseRate) +
          "</strong>" +
          "</span>" +
          "<span class='admin-seasonal-rate-price'>" +
          "<small>주말</small>" +
          "<strong>" +
          deps.formatKRW(
            resolveWeekendRate(row.weekdayBaseRate, row.weekendBaseRate),
          ) +
          "</strong>" +
          "</span>" +
          "<span class='admin-seasonal-rate-actions'>" +
          "<button type='button' class='admin-seasonal-rate-edit-btn' data-seasonal-edit='" +
          String(row.id) +
          "' aria-label='수정'>" +
          PENCIL_ICON +
          "</button>" +
          "<button type='button' class='admin-seasonal-rate-delete-btn' data-seasonal-delete='" +
          String(row.id) +
          "' aria-label='삭제'>×</button>" +
          "</span>" +
          "</div>"
        );
      })
      .join("");
    listEl.innerHTML = header + rows;
    listEl.querySelectorAll("[data-seasonal-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openEditModal(Number(btn.getAttribute("data-seasonal-edit")));
      });
    });
    listEl.querySelectorAll("[data-seasonal-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDeleteConfirm(Number(btn.getAttribute("data-seasonal-delete")));
      });
    });
  }

  function ymdFromDateObj(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function parseYmd(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return null;
    }
    var p = String(ymd).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
  }

  function isInRange(ymd) {
    if (!calRangeStart) {
      return false;
    }
    if (!calRangeEnd) {
      return ymd === calRangeStart;
    }
    return ymd >= calRangeStart && ymd <= calRangeEnd;
  }

  function renderDualCalendar(wrapEl, mode) {
    mode = mode || "add";
    if (!wrapEl) {
      return;
    }
    var months = [
      new Date(calView.getFullYear(), calView.getMonth(), 1),
      new Date(calView.getFullYear(), calView.getMonth() + 1, 1),
    ];
    wrapEl.innerHTML = months
      .map(function (monthDate, idx) {
        var y = monthDate.getFullYear();
        var m = monthDate.getMonth();
        var first = new Date(y, m, 1);
        var startPad = first.getDay();
        var lastDay = new Date(y, m + 1, 0).getDate();
        var cells = "";
        var i;
        for (i = 0; i < startPad; i += 1) {
          cells += "<span class='admin-seasonal-cal-cell is-empty'></span>";
        }
        for (i = 1; i <= lastDay; i += 1) {
          var cellDate = new Date(y, m, i);
          var ymd = ymdFromDateObj(cellDate);
          var cls = "admin-seasonal-cal-cell admin-seasonal-cal-day";
          if (ymd === calRangeStart || ymd === calRangeEnd) {
            cls += " is-endpoint";
          } else if (isInRange(ymd)) {
            cls += " is-range";
          }
          cells +=
            "<button type='button' class='" +
            cls +
            "' data-seasonal-cal-ymd='" +
            ymd +
            "' data-month-offset='" +
            String(idx) +
            "'>" +
            String(i) +
            "</button>";
        }
        return (
          "<div class='admin-seasonal-cal-month'>" +
          "<div class='admin-seasonal-cal-month__head'>" +
          (idx === 0
            ? "<button type='button' class='admin-seasonal-cal-nav' data-seasonal-cal-prev aria-label='이전 달'>‹</button>"
            : "<span class='admin-seasonal-cal-nav-spacer'></span>") +
          "<strong>" +
          MONTH_NAMES[m] +
          " " +
          String(y) +
          "</strong>" +
          (idx === 1
            ? "<button type='button' class='admin-seasonal-cal-nav' data-seasonal-cal-next aria-label='다음 달'>›</button>"
            : "<span class='admin-seasonal-cal-nav-spacer'></span>") +
          "</div>" +
          "<div class='admin-seasonal-cal-weekdays'><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>" +
          "<div class='admin-seasonal-cal-grid'>" +
          cells +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    wrapEl.querySelectorAll("[data-seasonal-cal-prev]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        calView = new Date(calView.getFullYear(), calView.getMonth() - 1, 1);
        renderDualCalendar(wrapEl, mode);
        if (mode === "edit") {
          syncEditPeriodInput();
          updateEditSaveState();
        } else {
          syncPeriodInput();
          updateSeasonalSaveState();
        }
      });
    });
    wrapEl.querySelectorAll("[data-seasonal-cal-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        calView = new Date(calView.getFullYear(), calView.getMonth() + 1, 1);
        renderDualCalendar(wrapEl, mode);
        if (mode === "edit") {
          syncEditPeriodInput();
          updateEditSaveState();
        } else {
          syncPeriodInput();
          updateSeasonalSaveState();
        }
      });
    });
    wrapEl.querySelectorAll("[data-seasonal-cal-ymd]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ymd = btn.getAttribute("data-seasonal-cal-ymd") || "";
        if (!calRangeStart || (calRangeStart && calRangeEnd)) {
          calRangeStart = ymd;
          calRangeEnd = "";
        } else if (ymd < calRangeStart) {
          calRangeEnd = calRangeStart;
          calRangeStart = ymd;
        } else {
          calRangeEnd = ymd;
        }
        renderDualCalendar(wrapEl, mode);
        if (mode === "edit") {
          syncEditPeriodInput();
          updateEditSaveState();
        } else {
          syncPeriodInput();
          updateSeasonalSaveState();
        }
      });
    });
  }

  function syncPeriodInput() {
    var input = document.getElementById("admin-seasonal-period-input");
    if (!input) {
      return;
    }
    if (calRangeStart && calRangeEnd) {
      input.value = formatPeriodLabel(calRangeStart, calRangeEnd);
    } else if (calRangeStart) {
      input.value = formatPeriodLabel(calRangeStart, calRangeStart);
    } else {
      input.value = "";
    }
  }

  function resetSeasonalForm() {
    editingId = null;
    calRangeStart = "";
    calRangeEnd = "";
    calView = new Date();
    calView.setDate(1);
    var roomSel = document.getElementById("admin-seasonal-room-select");
    var nameInput = document.getElementById("admin-seasonal-name-input");
    var weekdayInput = document.getElementById("admin-seasonal-weekday-input");
    var weekendInput = document.getElementById("admin-seasonal-weekend-input");
    var calWrap = document.getElementById("admin-seasonal-cal-wrap");
    if (roomSel) {
      roomSel.value = "G1";
    }
    if (nameInput) {
      nameInput.value = "";
    }
    if (weekdayInput) {
      weekdayInput.value = "";
    }
    if (weekendInput) {
      weekendInput.value = "";
    }
    if (calWrap) {
      renderDualCalendar(calWrap);
    }
    syncPeriodInput();
    syncWeekendFieldMode();
    updateSeasonalSaveState();
  }

  function isSeasonalFormValid() {
    var roomSel = document.getElementById("admin-seasonal-room-select");
    var weekdayInput = document.getElementById("admin-seasonal-weekday-input");
    var weekendInput = document.getElementById("admin-seasonal-weekend-input");
    if (!roomSel || !weekdayInput) {
      return false;
    }
    if (!calRangeStart || !calRangeEnd) {
      return false;
    }
    var weekday = parseRateValue(weekdayInput.value);
    if (!Number.isFinite(weekday) || weekday <= 0) {
      return false;
    }
    if (isSurchargeEnabled()) {
      return /^G[1-4]$/.test(String(roomSel.value || ""));
    }
    var weekend = parseRateValue(weekendInput && weekendInput.value);
    return (
      /^G[1-4]$/.test(String(roomSel.value || "")) &&
      Number.isFinite(weekend) &&
      weekend > 0
    );
  }

  function updateSeasonalSaveState() {
    var saveBtn = document.getElementById("admin-seasonal-save-btn");
    if (!saveBtn) {
      return;
    }
    var valid = isSeasonalFormValid();
    saveBtn.disabled = !valid;
    saveBtn.classList.toggle("is-disabled", !valid);
  }

  function collectSeasonalPayload() {
    var roomSel = document.getElementById("admin-seasonal-room-select");
    var nameInput = document.getElementById("admin-seasonal-name-input");
    var weekday = parseRateValue(
      document.getElementById("admin-seasonal-weekday-input").value,
    );
    var weekendInput = document.getElementById("admin-seasonal-weekend-input");
    var weekend = isSurchargeEnabled()
      ? resolveWeekendRate(weekday, 0)
      : parseRateValue(weekendInput && weekendInput.value);
    return {
      id: editingId,
      roomName: roomSel ? roomSel.value : "",
      optionName: nameInput ? String(nameInput.value || "").trim() : "",
      startDate: calRangeStart,
      endDate: calRangeEnd,
      weekdayBaseRate: weekday,
      weekendBaseRate: weekend,
    };
  }

  function applySeasonalRatesToPricing() {
    var P = root.GraffordBookingPricing;
    if (P && typeof P.setSeasonalRates === "function") {
      P.setSeasonalRates(seasonalRates);
    }
    renderActiveCriteria();
  }

  function postSeasonal(action, payload) {
    var auth = deps.getAuthPayload();
    return deps
      .adminPost("room-rate", Object.assign({ action: action }, payload, auth))
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data || {} };
        });
      });
  }

  function reloadSeasonalRatesFromResponse(data) {
    seasonalRates = Array.isArray(data.seasonalRates) ? data.seasonalRates : [];
    applySeasonalRatesToPricing();
    renderSeasonalList();
  }

  function saveSeasonalRate() {
    if (!isSeasonalFormValid()) {
      return;
    }
    var payload = collectSeasonalPayload();
    var action = editingId ? "seasonal-update" : "seasonal-save";
    postSeasonal(action, payload)
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          throw new Error(result.data.error || "저장 실패");
        }
        reloadSeasonalRatesFromResponse(result.data);
        closeSeasonalForm();
        closeEditModal();
        deps.showMessage("저장되었습니다.");
      })
      .catch(function (err) {
        deps.showMessage((err && err.message) || "저장 실패");
      });
  }

  function openDeleteConfirm(id) {
    pendingDeleteId = id;
    if (deps.setPolicyConfirmTitle) {
      deps.setPolicyConfirmTitle("요금 옵션을 삭제하시겠습니까?");
    }
    if (deps.setPolicyConfirmSaveLabel) {
      deps.setPolicyConfirmSaveLabel("삭제");
    }
    if (deps.policyConfirmModal) {
      deps.policyConfirmModal.hidden = false;
    }
  }

  function deleteSeasonalRate() {
    var id = pendingDeleteId;
    pendingDeleteId = null;
    if (!id) {
      return Promise.resolve();
    }
    return postSeasonal("seasonal-delete", { id: id })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          throw new Error(result.data.error || "삭제 실패");
        }
        reloadSeasonalRatesFromResponse(result.data);
        deps.showMessage("삭제되었습니다.");
      })
      .catch(function (err) {
        deps.showMessage((err && err.message) || "삭제 실패");
      });
  }

  function openEditModal(id) {
    var row = seasonalRates.filter(function (r) {
      return r.id === id;
    })[0];
    if (!row) {
      return;
    }
    editingId = id;
    calRangeStart = row.startDate;
    calRangeEnd = row.endDate;
    var start = parseYmd(row.startDate);
    if (start) {
      calView = new Date(start.getFullYear(), start.getMonth(), 1);
    }
    var modal = document.getElementById("admin-seasonal-edit-modal");
    var roomSel = document.getElementById("admin-seasonal-edit-room-select");
    var nameInput = document.getElementById("admin-seasonal-edit-name-input");
    var weekdayInput = document.getElementById("admin-seasonal-edit-weekday-input");
    var weekendInput = document.getElementById("admin-seasonal-edit-weekend-input");
    var calWrap = document.getElementById("admin-seasonal-edit-cal-wrap");
    if (roomSel) {
      roomSel.value = row.roomName;
    }
    if (nameInput) {
      nameInput.value = row.optionName || "";
    }
    if (weekdayInput) {
      weekdayInput.value = deps.formatKRW(row.weekdayBaseRate);
    }
    if (weekendInput && !isSurchargeEnabled()) {
      weekendInput.value = deps.formatKRW(
        resolveWeekendRate(row.weekdayBaseRate, row.weekendBaseRate),
      );
    }
    if (calWrap) {
      renderEditCalendar(calWrap);
    }
    syncEditPeriodInput();
    syncWeekendFieldMode();
    updateEditSaveState();
    if (modal) {
      modal.hidden = false;
    }
  }

  function closeEditModal() {
    editingId = null;
    var modal = document.getElementById("admin-seasonal-edit-modal");
    if (modal) {
      modal.hidden = true;
    }
  }

  function renderEditCalendar(wrapEl) {
    renderDualCalendar(wrapEl, "edit");
  }

  function syncEditPeriodInput() {
    var input = document.getElementById("admin-seasonal-edit-period-input");
    if (!input) {
      return;
    }
    if (calRangeStart && calRangeEnd) {
      input.value = formatPeriodLabel(calRangeStart, calRangeEnd);
    } else if (calRangeStart) {
      input.value = formatPeriodLabel(calRangeStart, calRangeStart);
    } else {
      input.value = "";
    }
  }

  function updateEditSaveState() {
    var saveBtn = document.getElementById("admin-seasonal-edit-save-btn");
    if (!saveBtn) {
      return;
    }
    var weekday = parseRateValue(
      document.getElementById("admin-seasonal-edit-weekday-input").value,
    );
    var weekendInput = document.getElementById("admin-seasonal-edit-weekend-input");
    var weekend = isSurchargeEnabled()
      ? resolveWeekendRate(weekday, 0)
      : parseRateValue(weekendInput && weekendInput.value);
    var valid =
      !!editingId &&
      !!calRangeStart &&
      !!calRangeEnd &&
      Number.isFinite(weekday) &&
      weekday > 0 &&
      (isSurchargeEnabled() || (Number.isFinite(weekend) && weekend > 0));
    saveBtn.disabled = !valid;
    saveBtn.classList.toggle("is-disabled", !valid);
  }

  function saveEditModal() {
    if (!editingId || !calRangeStart || !calRangeEnd) {
      return;
    }
    var weekdayRate = parseRateValue(
      document.getElementById("admin-seasonal-edit-weekday-input").value,
    );
    var weekendInput = document.getElementById("admin-seasonal-edit-weekend-input");
    var nameInput = document.getElementById("admin-seasonal-edit-name-input");
    var payload = {
      id: editingId,
      roomName:
        document.getElementById("admin-seasonal-edit-room-select").value,
      optionName: nameInput ? String(nameInput.value || "").trim() : "",
      startDate: calRangeStart,
      endDate: calRangeEnd,
      weekdayBaseRate: weekdayRate,
      weekendBaseRate: isSurchargeEnabled()
        ? resolveWeekendRate(weekdayRate, 0)
        : parseRateValue(weekendInput && weekendInput.value),
    };
    postSeasonal("seasonal-update", payload)
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          throw new Error(result.data.error || "수정 실패");
        }
        reloadSeasonalRatesFromResponse(result.data);
        closeEditModal();
        deps.showMessage("저장되었습니다.");
      })
      .catch(function (err) {
        deps.showMessage((err && err.message) || "수정 실패");
      });
  }

  function openSeasonalForm() {
    var form = document.getElementById("admin-seasonal-rate-form");
    var addBtn = document.getElementById("admin-seasonal-rate-add-btn");
    if (!form) {
      return;
    }
    resetSeasonalForm();
    form.hidden = false;
    if (addBtn) {
      addBtn.setAttribute("aria-expanded", "true");
      addBtn.classList.add("is-open");
    }
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeSeasonalForm() {
    var form = document.getElementById("admin-seasonal-rate-form");
    if (form) {
      form.hidden = true;
    }
    var addBtn = document.getElementById("admin-seasonal-rate-add-btn");
    if (addBtn) {
      addBtn.setAttribute("aria-expanded", "false");
      addBtn.classList.remove("is-open");
    }
    resetSeasonalForm();
  }

  function bindSeasonalUi() {
    var addBtn = document.getElementById("admin-seasonal-rate-add-btn");
    var cancelBtn = document.getElementById("admin-seasonal-cancel-btn");
    var saveBtn = document.getElementById("admin-seasonal-save-btn");
    var periodInput = document.getElementById("admin-seasonal-period-input");
    var calWrap = document.getElementById("admin-seasonal-cal-wrap");
    var nameInput = document.getElementById("admin-seasonal-name-input");
    var weekdayInput = document.getElementById("admin-seasonal-weekday-input");
    var weekendInput = document.getElementById("admin-seasonal-weekend-input");
    var roomSel = document.getElementById("admin-seasonal-room-select");

    if (addBtn && !addBtn.__bound) {
      addBtn.__bound = true;
      addBtn.addEventListener("click", openSeasonalForm);
    }
    if (cancelBtn && !cancelBtn.__bound) {
      cancelBtn.__bound = true;
      cancelBtn.addEventListener("click", closeSeasonalForm);
    }
    if (saveBtn && !saveBtn.__bound) {
      saveBtn.__bound = true;
      saveBtn.addEventListener("click", saveSeasonalRate);
    }
    if (periodInput && !periodInput.__bound) {
      periodInput.__bound = true;
      periodInput.addEventListener("click", function () {
        var popup = document.getElementById("admin-seasonal-cal-popup");
        if (popup) {
          popup.hidden = !popup.hidden;
          if (!popup.hidden && calWrap) {
            renderDualCalendar(calWrap);
          }
        }
      });
    }
    [nameInput, weekdayInput, weekendInput, roomSel].forEach(function (el) {
      if (!el || el.__boundSeasonal) {
        return;
      }
      el.__boundSeasonal = true;
      el.addEventListener("input", updateSeasonalSaveState);
      el.addEventListener("change", updateSeasonalSaveState);
    });
    if (calWrap) {
      renderDualCalendar(calWrap);
    }

    var editCancel = document.getElementById("admin-seasonal-edit-cancel-btn");
    var editSave = document.getElementById("admin-seasonal-edit-save-btn");
    var editPeriod = document.getElementById("admin-seasonal-edit-period-input");
    var editName = document.getElementById("admin-seasonal-edit-name-input");
    var editWeekday = document.getElementById("admin-seasonal-edit-weekday-input");
    var editWeekend = document.getElementById("admin-seasonal-edit-weekend-input");
    var editRoom = document.getElementById("admin-seasonal-edit-room-select");
    var editModal = document.getElementById("admin-seasonal-edit-modal");

    if (editCancel && !editCancel.__bound) {
      editCancel.__bound = true;
      editCancel.addEventListener("click", closeEditModal);
    }
    if (editSave && !editSave.__bound) {
      editSave.__bound = true;
      editSave.addEventListener("click", saveEditModal);
    }
    if (editPeriod && !editPeriod.__bound) {
      editPeriod.__bound = true;
      editPeriod.addEventListener("click", function () {
        var popup = document.getElementById("admin-seasonal-edit-cal-popup");
        if (popup) {
          popup.hidden = !popup.hidden;
          var editCal = document.getElementById("admin-seasonal-edit-cal-wrap");
          if (!popup.hidden && editCal) {
            renderEditCalendar(editCal);
          }
        }
      });
    }
    [editName, editWeekday, editWeekend, editRoom].forEach(function (el) {
      if (!el || el.__boundSeasonal) {
        return;
      }
      el.__boundSeasonal = true;
      el.addEventListener("input", updateEditSaveState);
      el.addEventListener("change", updateEditSaveState);
    });
    if (editModal && !editModal.__bound) {
      editModal.__bound = true;
      editModal.addEventListener("click", function (e) {
        if (e.target === editModal) {
          closeEditModal();
        }
      });
    }
  }

  function init(config) {
    deps = Object.assign(deps, config || {});
    bindSeasonalUi();
    renderSeasonalList();
    renderActiveCriteria();
  }

  function setSeasonalRates(rows) {
    seasonalRates = Array.isArray(rows) ? rows.slice() : [];
    applySeasonalRatesToPricing();
    renderSeasonalList();
    syncWeekendFieldMode();
  }

  function refreshActiveCriteria() {
    renderActiveCriteria();
    syncWeekendFieldMode();
  }

  function handlePolicyConfirmSave() {
    if (pendingDeleteId) {
      var id = pendingDeleteId;
      pendingDeleteId = null;
      return deleteSeasonalRate();
    }
    return Promise.resolve();
  }

  function isDeletePending() {
    return !!pendingDeleteId;
  }

  function clearDeletePending() {
    pendingDeleteId = null;
  }

  function resetSession() {
    closeEditModal();
    closeSeasonalForm();
    clearDeletePending();
  }

  root.GraffordAdminSeasonalRate = {
    init: init,
    setSeasonalRates: setSeasonalRates,
    refreshActiveCriteria: refreshActiveCriteria,
    handlePolicyConfirmSave: handlePolicyConfirmSave,
    isDeletePending: isDeletePending,
    clearDeletePending: clearDeletePending,
    resetSession: resetSession,
  };
})(typeof window !== "undefined" ? window : this);
