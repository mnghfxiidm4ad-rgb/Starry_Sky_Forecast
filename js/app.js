(() => {
  "use strict";

  const GSI_ATTR =
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

  const FALLBACK = {
    updatedAt: "2026-08-23T00:00:00+09:00",
    spots: [
      {
        id: "fuji-gogome",
        name: "富士山五合目",
        subtitle: "富士スバルライン五合目",
        prefecture: "山梨県",
        lat: 35.4285,
        lng: 138.7516,
        elevation: 2305,
        lightPollution: "中",
        starScore: 3,
        description:
          "標高約2,300mの高地から望む富士山周辺の夜空。空気が薄く透明度が出やすい一方、山梨・静岡方面の街明かりが地平線近くに乗るため、光害は中程度です。夏の天の川や冬のオリオン座の撮影ポイントとして知られますが、五合目の照明と観光客のヘッドライトには注意が必要です。",
        condition: {
          label: "条件つき可",
          cloudCover: 35,
          transparency: 3,
          seeing: 3,
          moonPhase: "上弦",
          moonIllumination: 48,
        },
      },
      {
        id: "achi",
        name: "長野県阿智村",
        subtitle: "ヘブンスそのはら・天空の楽園",
        prefecture: "長野県",
        lat: 35.4417,
        lng: 137.6153,
        elevation: 1400,
        lightPollution: "低",
        starScore: 5,
        description:
          "環境省の星空継続観察で「日本一の星空」と評された南信州の観測適地。標高約1,400mの富士見台高原は街明かりが届きにくく、夏は天の川、冬は澄んだ大気で星が点に写りやすいのが特徴です。ナイトツアー開催時は照明が一斉消灯されるため、肉眼観測・広角撮影の双方に向きます。",
        condition: {
          label: "観測・撮影ともに適",
          cloudCover: 8,
          transparency: 5,
          seeing: 4,
          moonPhase: "三日月",
          moonIllumination: 12,
        },
      },
      {
        id: "nosegawa",
        name: "奈良県野迫川村",
        subtitle: "近畿の秘境・南紀の星空",
        prefecture: "奈良県",
        lat: 34.1664,
        lng: 135.6308,
        elevation: 850,
        lightPollution: "低",
        starScore: 5,
        description:
          "紀伊山地の山深い村で、近畿地方でも有数の暗い夜空が残るエリアです。大阪・奈良盆地の光害から距離があり、天の川の中心部が夏の南の空に大きく広がります。標高と山に囲まれた地形のおかげで湿度が下がる夜は、広角の天の川撮影に適したコンディションになりやすいです。",
        condition: {
          label: "観測向き・薄雲注意",
          cloudCover: 22,
          transparency: 4,
          seeing: 4,
          moonPhase: "三日月",
          moonIllumination: 12,
        },
      },
      {
        id: "bisei",
        name: "岡山県美星町",
        subtitle: "美星天文台・星空保護区",
        prefecture: "岡山県",
        lat: 34.7608,
        lng: 133.5439,
        elevation: 447,
        lightPollution: "低",
        starScore: 4,
        description:
          "「星の町」として照明条例と星空保護の取り組みが早くから進んだエリア。美星天文台周辺は光害が抑えられ、晴れの国・岡山らしい快晴率の高さが観測計画を立てやすくします。標高は中程度ですが、西日本の都市光から適度に離れており、中口径の眼視や広角撮影の入門〜中級スポットです。",
        condition: {
          label: "観測・撮影ともに適",
          cloudCover: 15,
          transparency: 4,
          seeing: 3,
          moonPhase: "三日月",
          moonIllumination: 12,
        },
      },
      {
        id: "ishigaki",
        name: "沖縄県石垣島",
        subtitle: "石垣島天文台",
        prefecture: "沖縄県",
        lat: 24.3725,
        lng: 124.1392,
        elevation: 31,
        lightPollution: "低",
        starScore: 4,
        description:
          "北緯24度の低緯度から、本州では地平線近くになる南の星座を高く見上げられます。石垣島天文台周辺は比較的暗い空が残り、冬の南天や夏の天の川南端の撮影に適します。亜熱帯特有の水蒸気で透明度が落ちる夜もあるため、湿度と雲の流れを見て計画するのがコツです。",
        condition: {
          label: "南天向き・湿度注意",
          cloudCover: 28,
          transparency: 3,
          seeing: 4,
          moonPhase: "上弦",
          moonIllumination: 48,
        },
      },
    ],
  };

  const els = {
    map: document.getElementById("map"),
    panel: document.getElementById("side-panel"),
    panelContent: document.getElementById("panel-content"),
    panelClose: document.getElementById("panel-close"),
    backdrop: document.getElementById("panel-backdrop"),
    chips: document.getElementById("spot-chips"),
    mockDate: document.getElementById("mock-date"),
  };

  const markersById = new Map();
  let map;
  let clusterGroup;
  let activeId = null;
  let lastFocus = null;
  let selectedDayIndex = 0;
  let allSpots = [];
  let forecastNights = [];

  const bortleToScore = (bortle) => {
    const n = Number(bortle);
    if (!Number.isFinite(n)) return 3;
    if (n <= 2) return 5;
    if (n === 3) return 4;
    if (n === 4) return 3;
    return 2;
  };

  const bortleToPollution = (bortle) => {
    const n = Number(bortle);
    if (n <= 3) return "低";
    if (n === 4) return "中";
    return "高";
  };

  function normalizeSpot(raw) {
    const elevation = Number(raw.elevation ?? raw.elevation_m ?? 0);
    const bortle = raw.bortle_scale;
    const starScore = Number(
      raw.starScore ?? (bortle != null ? bortleToScore(bortle) : 3)
    );
    return {
      ...raw,
      lat: Number(raw.lat),
      lng: Number(raw.lng ?? raw.lon),
      elevation,
      elevation_m: elevation,
      lon: Number(raw.lon ?? raw.lng),
      starScore: Math.max(1, Math.min(5, starScore || 3)),
      lightPollution: raw.lightPollution || (bortle != null ? bortleToPollution(bortle) : "中"),
      subtitle: raw.subtitle || raw.category || "",
      description: raw.description || "",
      prefecture: raw.prefecture || "",
    };
  }

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  const stars = (score) => {
    const on = "★".repeat(score);
    const off = "★".repeat(5 - score);
    return `<span class="score-stars" aria-label="星空スコア ${score} / 5">${on}<span class="dim">${off}</span></span>`;
  };

  const pinIcon = (score, active) =>
    L.divIcon({
      className: `spot-pin score-${score}${active ? " is-active" : ""}`,
      html: `<span class="spot-pin__inner">${score}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadOptional(url) {
    try {
      return await fetchJson(url);
    } catch {
      const embedded = window.HOSHIZORA_DATA || {};
      if (url.indexOf("auto_spots") !== -1 && embedded.autoSpots) return embedded.autoSpots;
      if (url.indexOf("forecast") !== -1 && embedded.forecast) return embedded.forecast;
      if (url.indexOf("spots.json") !== -1 && embedded.spots) return embedded.spots;
      return null;
    }
  }

  async function loadSpots() {
    const [auto, forecast, spots] = await Promise.all([
      loadOptional("./data/auto_spots.json"),
      loadOptional("./data/forecast.json"),
      loadOptional("./data/spots.json"),
    ]);
    const baseList = auto?.spots || spots?.spots || FALLBACK.spots;
    const forecastList = Array.isArray(forecast?.spots) ? forecast.spots : [];
    const byId = new Map(forecastList.map((s) => [s.id, s]));
    const byName = new Map(forecastList.map((s) => [s.name, s]));
    const merged = baseList.map((raw) => {
      const spot = normalizeSpot(raw);
      const live = byId.get(spot.id) || byName.get(spot.name);
      if (!live) return spot;
      const liveNorm = normalizeSpot(live);
      return {
        ...spot,
        ...liveNorm,
        lat: spot.lat,
        lng: spot.lng,
        lon: spot.lon,
        daily: liveNorm.daily || spot.daily || [],
        starScore: liveNorm.starScore,
        condition: liveNorm.condition || spot.condition,
        hourlyCloud: liveNorm.hourlyCloud,
      };
    });
    const sourceFile = auto
      ? "./data/auto_spots.json"
      : forecast
        ? "./data/forecast.json"
        : spots
          ? "./data/spots.json"
          : "fallback";
    const nights = forecast?.nightWindow?.nights || forecastList[0]?.daily?.map((d) => d.date) || [];
    return {
      updatedAt: forecast?.updatedAt || auto?.updatedAt || spots?.updatedAt || FALLBACK.updatedAt,
      sourceFile,
      hasForecast: Boolean(forecastList.length),
      nights,
      spots: merged,
    };
  }

  function createMap() {
    const std = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
      { attribution: GSI_ATTR, maxZoom: 18, minZoom: 5 }
    );
    const pale = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
      { attribution: GSI_ATTR, maxZoom: 18, minZoom: 5 }
    );
    const photo = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
      { attribution: GSI_ATTR, maxZoom: 18, minZoom: 5 }
    );

    map = L.map(els.map, {
      center: [35.4, 135.8],
      zoom: 6,
      zoomControl: false,
      layers: [std],
    });

    els.map.classList.add("map--night");
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control
      .layers(
        {
          標準地図: std,
          淡色地図: pale,
          航空写真: photo,
        },
        null,
        { position: "topright" }
      )
      .addTo(map);

    map.on("baselayerchange", (event) => {
      els.map.classList.toggle("map--night", event.name !== "航空写真");
    });

    clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      maxClusterRadius: 56,
      chunkedLoading: true,
      animateAddingMarkers: false,
      spiderfyDistanceMultiplier: 1.3,
    });
    clusterGroup.addTo(map);

    return map;
  }

  function renderChips(spots) {
    const featured = spots
      .filter((spot) => spot.source === "curated" || spot.starScore >= 4)
      .slice(0, 10);
    const shown = featured.length ? featured : spots.slice(0, 8);
    const nodes = shown.map((spot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spot-chip";
      btn.dataset.id = spot.id;
      btn.textContent = spot.name;
      btn.addEventListener("click", () => openSpot(spot, true));
      return btn;
    });
    if (spots.length > shown.length) {
      const more = document.createElement("span");
      more.className = "spot-chip-count";
      more.textContent = "地図に" + spots.length + "件";
      nodes.push(more);
    }
    els.chips.replaceChildren(...nodes);
  }

  function setActive(id) {
    activeId = id;
    els.chips.querySelectorAll(".spot-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.id === id);
    });
    markersById.forEach((entry, key) => {
      entry.marker.setIcon(pinIcon(entry.spot.starScore, key === id));
    });
  }

  function applyDay(index) {
    selectedDayIndex = index;
    allSpots.forEach((spot) => {
      const day = Array.isArray(spot.daily) ? spot.daily[index] : null;
      if (!day) return;
      spot.starScore = day.starScore;
      spot.hourlyCloud = day.hourlyCloud || [];
      spot.condition = {
        label: day.label,
        cloudCover: day.cloudCover,
        moonPhase: day.moonPhaseName,
        moonIllumination: day.moonIllumination,
        moonAge: day.moonAge,
      };
    });
    document.querySelectorAll(".date-bar__btn").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.index) === index);
    });
    markersById.forEach((entry, key) => {
      entry.marker.setIcon(pinIcon(entry.spot.starScore, key === activeId));
    });
    if (els.panel.classList.contains("is-open") && activeId) {
      const current = allSpots.find((s) => s.id === activeId);
      if (current) els.panelContent.innerHTML = panelHtml(current);
    }
  }

  function dateLabel(iso, index) {
    if (index === 0) return { main: "今日", sub: iso.slice(5).replace("-", "/") };
    if (index === 1) return { main: "明日", sub: iso.slice(5).replace("-", "/") };
    const dt = new Date(iso + "T12:00:00");
    const wd = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
    return { main: iso.slice(5).replace("-", "/"), sub: wd };
  }

  function renderDateBar(nights) {
    const bar = document.getElementById("date-bar");
    if (!bar) return;
    if (!nights.length) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.replaceChildren(
      ...nights.map((iso, index) => {
        const label = dateLabel(iso, index);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "date-bar__btn" + (index === selectedDayIndex ? " is-active" : "");
        btn.dataset.index = String(index);
        btn.innerHTML = `<strong>${label.main}</strong><small>${label.sub}</small>`;
        btn.addEventListener("click", () => applyDay(index));
        return btn;
      })
    );
  }

  function calendarHtml(spot) {
    const days = Array.isArray(spot.daily) ? spot.daily : [];
    if (!days.length) return "";
    const cards = days
      .map((day, index) => {
        const label = dateLabel(day.date, index);
        const near = index < 7;
        return `<button type="button" class="cal-card score-${day.starScore}${index === selectedDayIndex ? " is-active" : ""}" data-day="${index}">
          <span class="cal-card__date">${escapeHtml(label.main)} ${escapeHtml(label.sub)}</span>
          <span class="cal-card__score">${"★".repeat(day.starScore)} ${day.score100}点</span>
          <span class="cal-card__meta">雲${day.cloudCover}% / ${escapeHtml(day.moonPhaseName)}${near ? " / 時間別あり" : ""}</span>
        </button>`;
      })
      .join("");
    return `<section class="calendar" aria-label="16日間の星空予報">
      <h3 class="calendar__title">16日予報</h3>
      <div class="calendar__grid">${cards}</div>
    </section>`;
  }

  function hourlyCloudHtml(hours) {
    if (!Array.isArray(hours) || hours.length === 0) return "";
    const items = hours
      .map((row) => {
        const cloud = Number(row.cloudCover ?? 0);
        const label = escapeHtml(row.hour || "");
        const cls = cloud <= 30 ? "is-clear" : cloud <= 60 ? "is-mid" : "is-thick";
        const hourLabel = label.replace(":00", "");
        return `<div class="hourly__item ${cls}" title="${label} 雲量 ${cloud}%">
          <div class="hourly__bar-wrap"><span style="height:${cloud}%"></span></div>
          <span class="hourly__time">${hourLabel}</span>
        </div>`;
      })
      .join("");
    return `<section class="hourly" aria-label="時間帯別雲量">
      <h3 class="hourly__title">この日の雲量（20時〜翌3時・直近7日）</h3>
      <div class="hourly__bars">${items}</div>
    </section>`;
  }

  function panelHtml(spot) {
    const c = spot.condition || {};
    const cloud = Number(c.cloudCover ?? 0);
    const live = Boolean(spot.hourlyCloud);
    const kicker = live ? "今夜の予報" : "今夜の判定（モック）";
    return `
      <p class="panel-kicker">${escapeHtml(spot.prefecture)} ・ ${kicker}</p>
      <h2 class="panel-title" id="panel-title">${escapeHtml(spot.name)}</h2>
      <p class="panel-subtitle">${escapeHtml(spot.subtitle || "")}</p>
      <div class="score-row">
        ${stars(spot.starScore)}
        <span class="condition-pill">${escapeHtml(c.label || (spot.winter_closure ? "冬季注意" : "標高ベース判定"))}</span>
      </div>
      <dl class="stats">
        <div class="stat"><dt>標高</dt><dd>${escapeHtml(spot.elevation)} m</dd></div>
        <div class="stat"><dt>光害度</dt><dd>${escapeHtml(spot.lightPollution)}${spot.bortle_scale != null ? " / Bortle " + escapeHtml(spot.bortle_scale) : ""}</dd></div>
        <div class="stat"><dt>月相</dt><dd>${escapeHtml(c.moonPhase || "—")}</dd></div>
        <div class="stat"><dt>月明かり</dt><dd>${escapeHtml(c.moonIllumination ?? "—")}%</dd></div>
      </dl>
      <p class="panel-desc">${escapeHtml(spot.description)}</p>
      ${spot.notes ? `<p class="panel-notes">${escapeHtml(spot.notes)}</p>` : ""}
      <div class="condition-grid">
        <div class="meter">
          <label><span>今夜の平均雲量</span><span>${cloud}%</span></label>
          <div class="meter-bar"><span style="width:${cloud}%"></span></div>
        </div>
      </div>
      ${hourlyCloudHtml(spot.hourlyCloud)}
      ${calendarHtml(spot)}
      <section class="ad-slot" aria-label="スポンサーリンク枠">
        <p class="ad-slot__label">スポンサーリンク</p>
        <div class="ad-slot__box">
          広告用プレースホルダー
          <small>300 × 250 想定</small>
        </div>
      </section>
    `;
  }

  function panToSpot(spot) {
    const latlng = L.latLng(spot.lat, spot.lng);
    const zoom = Math.max(map.getZoom(), 8);
    map.setView(latlng, zoom, { animate: true });

    requestAnimationFrame(() => {
      const point = map.latLngToContainerPoint(latlng);
      if (isMobile()) {
        map.panBy([0, Math.round(window.innerHeight * 0.22)], { animate: true });
      } else {
        const panelWidth = els.panel.getBoundingClientRect().width || 400;
        const targetX = panelWidth + (window.innerWidth - panelWidth) / 2;
        map.panBy([point.x - targetX, point.y - window.innerHeight / 2], {
          animate: true,
        });
      }
    });
  }

  function openSpot(spot, shouldPan) {
    lastFocus = document.activeElement;
    els.panelContent.innerHTML = panelHtml(spot);
    els.panelContent.querySelectorAll(".cal-card").forEach((card) => {
      card.addEventListener("click", () => applyDay(Number(card.dataset.day)));
    });
    els.panel.classList.add("is-open");
    els.panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-panel-open");
    els.backdrop.hidden = false;
    setActive(spot.id);
    els.panelClose.focus();
    if (shouldPan) panToSpot(spot);
  }

  function closePanel() {
    els.panel.classList.remove("is-open");
    els.panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-panel-open");
    els.backdrop.hidden = true;
    setActive(null);
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function placeMarkers(spots) {
    if (clusterGroup) clusterGroup.clearLayers();
    markersById.clear();
    const bounds = [];
    const layers = [];
    spots.forEach((spot) => {
      if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return;
      const marker = L.marker([spot.lat, spot.lng], {
        icon: pinIcon(spot.starScore, false),
        title: `${spot.name} 星空スコア${spot.starScore}`,
        keyboard: true,
        riseOnHover: true,
      });
      marker.on("click", () => openSpot(spot, true));
      markersById.set(spot.id, { marker, spot });
      layers.push(marker);
      bounds.push([spot.lat, spot.lng]);
    });
    clusterGroup.addLayers(layers);

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 7 });
    }
  }

  function bindUi() {
    els.panelClose.addEventListener("click", closePanel);
    els.backdrop.addEventListener("click", closePanel);
    map.on("click", closePanel);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.panel.classList.contains("is-open")) {
        closePanel();
      }
    });
  }

  function setHeaderMeta(data) {
    const date = new Date(data.updatedAt);
    const live = Boolean(data.hasForecast);
    const badge = document.querySelector(".site-header__badge");
    if (!Number.isNaN(date.getTime())) {
      const stamp = new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
      els.mockDate.textContent = "更新 " + stamp;
      els.mockDate.title = "予報データの更新日時";
    }
    if (badge) {
      const count = Array.isArray(data.spots) ? data.spots.length : 0;
      badge.textContent = (live ? "Open-Meteo" : "自動収集") + " " + count + "件";
    }
  }

  async function init() {
    const data = await loadSpots();
    allSpots = data.spots;
    forecastNights = data.nights || [];
    selectedDayIndex = 0;
    setHeaderMeta(data);
    createMap();
    renderDateBar(forecastNights);
    applyDay(0);
    renderChips(allSpots);
    placeMarkers(allSpots);
    bindUi();
  }

  init();
})();
