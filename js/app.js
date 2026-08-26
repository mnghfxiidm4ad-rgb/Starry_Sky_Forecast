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
    panelExpand: document.getElementById("panel-expand"),
    panelHandle: document.getElementById("panel-handle"),
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
    const bortle = raw.bortle_scale ?? raw.bortle_scale;
    const starScore = Number(raw.starScore ?? (bortle != null ? bortleToScore(bortle) : 3));
    return {
      ...raw,
      lat: Number(raw.lat),
      lng: Number(raw.lng ?? raw.lon),
      elevation,
      elevation_m: elevation,
      lon: Number(raw.lon ?? raw.lng),
      starScore: Math.max(1, Math.min(5, starScore || 3)),
      lightPollution: raw.lightPollution || (bortle != null ? bortleToPollution(bortle) : "中"),
      bortle_scale: bortle,
      subtitle: raw.subtitle || raw.category || "",
      description: raw.description || "",
      overview: raw.overview || "",
      viewDirection: raw.viewDirection || "",
      surroundings: raw.surroundings || "",
      accessNotes: raw.accessNotes || "",
      prefecture: raw.prefecture || "",
      category: raw.category || raw.subtitle || "",
      has_parking: raw.has_parking ?? raw.has_parking,
      has_toilet: raw.has_toilet ?? raw.has_toilet,
      is_24h: raw.is_24h ?? raw.is_24h,
      winter_closure: raw.winter_closure ?? raw.winter_closure,
      notes: raw.notes || raw.notes || "",
    };
  }

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");


  const SYNODIC = 29.530588853;
  const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14, 0);

  function moonFromDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    let age = ((d.getTime() - KNOWN_NEW) / 86400000) % SYNODIC;
    if (age < 0) age += SYNODIC;
    const phase = age / SYNODIC;
    const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);
    let name = "有明月";
    if (age < 1.85 || age >= 27.69) name = "新月";
    else if (age < 5.54) name = "三日月";
    else if (age < 9.23) name = "上弦の月";
    else if (age < 13.0) name = "十三夜";
    else if (age < 16.5) name = "満月";
    else if (age < 20.2) name = "十八夜";
    else if (age < 23.9) name = "下弦の月";
    return { name, illumination, age: Math.round(age * 10) / 10 };
  }

  function selectedNightDate() {
    const iso = forecastNights[selectedDayIndex];
    if (iso) return new Date(iso + "T21:00:00+09:00");
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 3600000);
    if (jst.getUTCHours() < 4) jst.setUTCDate(jst.getUTCDate() - 1);
    return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 12, 0, 0));
  }

  function phaseText(value) {
    if (value == null || value === "" || value === "—") return "";
    if (typeof value === "number") return "";
    const text = String(value).trim();
    if (!text || /^\d+(\.\d+)?$/.test(text)) return "";
    return text;
  }

  function resolveMoon(spot) {
    const computed = moonFromDate(selectedNightDate());
    const day = Array.isArray(spot.daily) ? spot.daily[selectedDayIndex] : null;
    const c = spot.condition || {};
    const name = phaseText(c.moonPhase) || phaseText(day && (day.moonPhaseName || day.moonPhaseName)) || computed.name;
    const illumRaw = c.moonIllumination ?? (day && (day.moonIllumination ?? day.moonIllumination));
    const illumination = Number.isFinite(Number(illumRaw)) ? Math.round(Number(illumRaw)) : computed.illumination;
    const ageRaw = c.moonAge ?? (day && (day.moonAge ?? day.moonAge));
    const age = Number.isFinite(Number(ageRaw)) ? Number(ageRaw) : computed.age;
    return { name, illumination, age };
  }

  function formatStamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "/" + p(date.getMonth() + 1) + "/" + p(date.getDate()) + " " + p(date.getHours()) + ":" + p(date.getMinutes()) + " 更新";
  }

  function flagText(flag, yes, no) {
    if (flag === true) return yes;
    if (flag === false) return no;
    return "情報なし";
  }

  function defaultViewDirection(spot) {
    const lat = Number(spot.lat);
    if (lat && lat < 27) return "南〜南東（低緯度のため南天の星座が高く、夏は天の川の中心も見上げやすい）";
    if (Number(spot.elevation) >= 1500) return "南〜南西（高地で地平まで開けやすく、夏の天の川と冬のオリオン座が狙い目）";
    return "南〜南東（日本の観測では天の川中心が南寄りに見えることが多く、街明かりの少ない方角を優先）";
  }

  function defaultSurroundings(spot) {
    const pollution = spot.lightPollution || "中";
    const bortle = spot.bortle_scale != null ? "Bortle " + spot.bortle_scale + " 相当" : "光害度「" + pollution + "」";
    const elev = Number(spot.elevation) || 0;
    const air = elev >= 1000 ? "標高があり大気が薄く、透明度が出やすい傾向です。" : elev >= 400 ? "丘陵〜山地で、盆地の街明かりから距離を取りやすい立地です。" : "低地のため、遠方の都市光が地平線に乗る夜があります。";
    return (spot.prefecture || "当地") + "の" + (spot.category || spot.subtitle || "観測地点") + "周辺は、" + bortle + "の空の明るさです。" + air + "肉眼では天頂付近、撮影では街明かりと反対側の方位を選ぶとコントラストが乗りやすくなります。";
  }

  function defaultAccessNotes(spot) {
    const parking = flagText(spot.has_parking ?? spot.has_parking, "駐車場の記載あり", "駐車場の記載なし（路肩駐車は避け、公共スペースを確認）");
    const toilet = flagText(spot.has_toilet ?? spot.has_toilet, "トイレの記載あり", "トイレの記載なし（事前に沿道の公衆トイレを済ませる）");
    const winter = spot.winter_closure || spot.winter_closure ? "標高や積雪の関係で冬季閉鎖の可能性があります。" : "";
    const hours = (spot.is_24h || spot.is_24h) ? "終日利用の記載がありますが、現地の門扉・禁止事項を優先してください。" : "夜間開放の可否は施設・自治体の案内を優先してください。";
    return parking + "。" + toilet + "。" + hours + winter + "夜間は気温が急低下し、段差や濡れた岩場で転倒しやすいため、ヘッドライトは足元確認の最短に留め、防寒と予備電池を用意してください。";
  }

  function defaultOverview(spot) {
    const name = spot.name || "この地点";
    const pref = spot.prefecture || "日本";
    const cat = spot.category || spot.subtitle || "観測スポット";
    const elev = Number(spot.elevation) || 0;
    const elevText = elev ? "標高約" + elev.toLocaleString("ja-JP") + "m" : "標高情報は未整備";
    return (
      pref + "の" + cat + "「" + name + "」は、" + elevText +
      "に位置する星空観測の候補地です。周辺の光害度は「" + (spot.lightPollution || "中") +
      "」で、街明かりから離れた方角を選べば天の川や明るい星座を追いやすくなります。" +
      "地図上のスコアは雲量・月明かり・湿度・光害を総合した目安なので、現地では風と足元の安全もあわせて判断してください。" +
      "夜間は急な冷え込みと路面の濡れに備え、ヘッドライトは足元確認の最短に留め、私有地や施設の消灯ルールを守って短時間でも計画的に利用しましょう。"
    );
  }

  function buildSpotCopy(spot) {
    return {
      overview: spot.overview && String(spot.overview).length >= 80 ? spot.overview : (spot.description && String(spot.description).length >= 80 ? spot.description : defaultOverview(spot)),
      viewDirection: spot.viewDirection || defaultViewDirection(spot),
      surroundings: spot.surroundings || defaultSurroundings(spot),
      accessNotes: spot.accessNotes || spot.notes || defaultAccessNotes(spot),
    };
  }

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

  function uniqueSpotList(lists) {
    const seen = new Set();
    const out = [];
    lists.flat().forEach((raw) => {
      if (!raw) return;
      const lat = Number(raw.lat);
      const lng = Number(raw.lng ?? raw.lon);
      const key = String(raw.id || `${raw.name}|${lat.toFixed(5)}|${lng.toFixed(5)}`);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(raw);
    });
    return out;
  }

  function categoryLabel(spot) {
    const cat = String(spot.category || spot.subtitle || "");
    if (cat === "camp_site" || cat === "キャンプ場") return "キャンプ場";
    if (cat === "viewpoint" || cat === "展望台") return "展望台";
    if (cat === "michinoeki" || cat === "道の駅") return "道の駅";
    return cat;
  }

  function categoryBadge(spot) {
    const label = categoryLabel(spot);
    if (!label) return "";
    const kind = label === "キャンプ場" ? "camp" : "place";
    return `<span class="category-badge category-badge--${kind}">${escapeHtml(label)}</span>`;
  }

  async function loadSpots() {
    const [auto, forecast, spots] = await Promise.all([
      loadOptional("./data/auto_spots.json"),
      loadOptional("./data/forecast.json"),
      loadOptional("./data/spots.json"),
    ]);
    const baseList = uniqueSpotList([spots?.spots || [], auto?.spots || []]);
    if (!baseList.length) baseList.push(...FALLBACK.spots);
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
        overview: spot.overview || liveNorm.overview,
        viewDirection: spot.viewDirection || liveNorm.viewDirection,
        surroundings: spot.surroundings || liveNorm.surroundings,
        accessNotes: spot.accessNotes || liveNorm.accessNotes,
        description: spot.description || liveNorm.description,
      };
    });
    const sourceFile = auto
      ? "./data/auto_spots.json"
      : forecast
        ? "./data/forecast.json"
        : spots
          ? "./data/spots.json"
          : "fallback";
    const nights = forecast?.nightWindow?.nights || forecast?.nightWindow?.nights || forecastList[0]?.daily?.map((d) => d.date || d.date) || [];
    return {
      updatedAt: forecast?.updatedAt || forecast?.updatedAt || auto?.updatedAt || auto?.updatedAt || spots?.updatedAt || spots?.updatedAt || FALLBACK.updatedAt,
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
    const computed = moonFromDate(selectedNightDate());
    allSpots.forEach((spot) => {
      const day = Array.isArray(spot.daily) ? spot.daily[index] : null;
      if (day) {
        spot.starScore = day.starScore ?? day.starScore;
        spot.hourlyCloud = day.hourlyCloud || day.hourlyCloud || [];
        spot.condition = {
          label: day.label || day.label,
          cloudCover: day.cloudCover ?? day.cloudCover,
          humidity: day.humidity ?? day.humidity,
          hasForecast: true,
          moonPhase: day.moonPhaseName || day.moonPhaseName || computed.name,
          moonIllumination: day.moonIllumination ?? day.moonIllumination ?? computed.illumination,
          moonAge: day.moonAge ?? day.moonAge ?? computed.age,
        };
        return;
      }
      spot.hourlyCloud = [];
      spot.condition = {
        ...(spot.condition || {}),
        label: "気象予報なし",
        cloudCover: null,
        humidity: null,
        hasForecast: false,
        moonPhase: computed.name,
        moonIllumination: computed.illumination,
        moonAge: computed.age,
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
      if (current) {
        const expanded = els.panel.classList.contains("is-expanded");
        els.panelContent.innerHTML = panelHtml(current);
        bindPanelEvents();
        if (!isMobile() || expanded) expandPanel();
        else collapsePanel();
      }
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

  function cloudIcon(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { symbol: "–", text: "なし" };
    if (n <= 30) return { symbol: "☀", text: n + "%" };
    if (n <= 60) return { symbol: "⛅", text: n + "%" };
    return { symbol: "☁", text: n + "%" };
  }

  function calendarHtml(spot) {
    const days = Array.isArray(spot.daily) ? spot.daily : [];
    if (!days.length) return "";
    const cards = days
      .map((day, index) => {
        const label = dateLabel(day.date, index);
        const cloud = cloudIcon(day.cloudCover);
        const score = Number(day.starScore) || 1;
        const age = Number.isFinite(Number(day.moonAge)) ? Number(day.moonAge).toFixed(1) : "–";
        return `<button type="button" class="cal-card score-${score}${index === selectedDayIndex ? " is-active" : ""}" data-day="${index}" aria-label="${escapeHtml(label.main)} スコア${score} 雲量${cloud.text} 月齢${age}">
          <span class="cal-card__date">${escapeHtml(label.main)}<small>${escapeHtml(label.sub)}</small></span>
          <span class="cal-card__score">${"★".repeat(score)}<span class="dim">${"★".repeat(Math.max(0, 5 - score))}</span></span>
          <span class="cal-card__cloud">${cloud.symbol} ${escapeHtml(cloud.text)}</span>
          <span class="cal-card__moon">月齢 ${escapeHtml(age)}</span>
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
    const moon = resolveMoon(spot);
    const c = spot.condition || {};
    const copy = buildSpotCopy(spot);
    const hasForecast = c.hasForecast === true || (Array.isArray(spot.daily) && spot.daily[selectedDayIndex] && Number.isFinite(Number(spot.daily[selectedDayIndex].cloudCover ?? spot.daily[selectedDayIndex].cloudCover)));
    const cloudRaw = c.cloudCover;
    const hasCloud = hasForecast && Number.isFinite(Number(cloudRaw));
    const cloud = hasCloud ? Math.round(Number(cloudRaw)) : null;
    const humidity = c.humidity;
    const live = Boolean(spot.hourlyCloud && spot.hourlyCloud.length);
    const kicker = hasForecast ? "選択日の気象予報" : "気象予報なし（月相は計算値）";
    const cloudLabel = selectedDayIndex === 0 ? "今夜の平均雲量" : "この夜の平均雲量";
    const cloudText = hasCloud ? cloud + "%" : "予報なし";
    const humidityBlock = hasForecast && Number.isFinite(Number(humidity))
      ? `<div class="meter"><label><span>夜間の平均湿度</span><span>${Math.round(Number(humidity))}%</span></label><div class="meter-bar"><span style="width:${Math.round(Number(humidity))}%"></span></div></div>`
      : "";
    const forecastNote = hasForecast
      ? ""
      : `<p class="panel-notice">この地点には選択した夜の気象予報がありません。月相・月明かりは日付から計算した値、星空スコアは標高と光害の静的な目安です。</p>`;
    return `
      <div class="panel-peek">
      <p class="panel-kicker">${escapeHtml(spot.prefecture || "")} ・ ${escapeHtml(categoryLabel(spot) || "観測スポット")} ・ ${kicker}</p>
      <h2 class="panel-title" id="panel-title">${escapeHtml(spot.name)} ${categoryBadge(spot)}</h2>
      <p class="panel-subtitle">${escapeHtml(spot.subtitle || "")}</p>
      <div class="score-row">
        ${stars(spot.starScore)}
        <span class="condition-pill">${escapeHtml(c.label || (spot.winter_closure ? "冬季注意" : "標高ベース判定"))}</span>
      </div>
      </div>
      <div class="panel-details">
      <dl class="stats">
        <div class="stat"><dt>標高</dt><dd>${escapeHtml(spot.elevation)} m</dd></div>
        <div class="stat"><dt>光害度</dt><dd>${escapeHtml(spot.lightPollution)}${spot.bortle_scale != null ? " / Bortle " + escapeHtml(spot.bortle_scale) : ""}</dd></div>
        <div class="stat"><dt>月相</dt><dd>${escapeHtml(moon.name)}</dd></div>
        <div class="stat"><dt>月明かり</dt><dd>${escapeHtml(moon.illumination)}%</dd></div>
        <div class="stat"><dt>${cloudLabel}</dt><dd>${cloudText}</dd></div>
      </dl>
      <p class="panel-moon-note">月齢 ${escapeHtml(moon.age)} 日相当 ／ 輝面比 ${escapeHtml(moon.illumination)}%（選択した日付の21時時点）</p>
      ${forecastNote}
      ${humidityBlock ? `<div class="condition-grid">${humidityBlock}</div>` : ""}
      <section class="panel-article"><h3>スポットの概要・見どころ</h3><p>${escapeHtml(copy.overview)}</p></section>
      <section class="panel-article"><h3>開けている方角</h3><p>${escapeHtml(copy.viewDirection)}</p></section>
      <section class="panel-article"><h3>光害と周辺環境</h3><p>${escapeHtml(copy.surroundings)}</p></section>
      <section class="panel-article">
        <h3>現地の注意点</h3>
        <p>${escapeHtml(copy.accessNotes)}</p>
        <ul class="panel-facilities">
          <li>駐車場：${escapeHtml(flagText(spot.has_parking ?? spot.has_parking, "あり", "なし／未確認"))}</li>
          <li>トイレ：${escapeHtml(flagText(spot.has_toilet ?? spot.has_toilet, "あり", "なし／未確認"))}</li>
          <li>夜間利用：${escapeHtml((spot.is_24h || spot.is_24h) ? "終日の記載あり" : "要確認")}</li>
        </ul>
      </section>
      ${hourlyCloudHtml(spot.hourlyCloud)}
      ${calendarHtml(spot)}
      <section class="ad-slot" aria-label="スポンサーリンク枠">
        <p class="ad-slot__label">スポンサーリンク</p>
        <div class="ad-slot__box">
          <ins class="adsbygoogle"
               style="display:block;min-height:250px;width:100%"
               data-ad-client="ca-pub-2075840815269276"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
        </div>
      </section>
      </div>
    `;
  }

  function bindPanelEvents() {
    els.panelContent.querySelectorAll(".cal-card").forEach((card) => {
      card.addEventListener("click", () => applyDay(Number(card.dataset.day)));
    });
    fillAdSlot();
  }

  function fillAdSlot() {
    const slot = els.panelContent.querySelector("ins.adsbygoogle");
    if (!slot || slot.getAttribute("data-adsbygoogle-status")) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      /* AdSense 未読込時はプレースホルダーのまま */
    }
  }

  function panToSpot(spot) {
    const latlng = L.latLng(spot.lat, spot.lng);
    const zoom = Math.max(map.getZoom(), 8);
    map.setView(latlng, zoom, { animate: true });

    requestAnimationFrame(() => {
      const point = map.latLngToContainerPoint(latlng);
      if (isMobile()) {
        map.panBy([0, Math.round(window.innerHeight * 0.12)], { animate: true });
      } else {
        const panelWidth = els.panel.getBoundingClientRect().width || 400;
        const targetX = panelWidth + (window.innerWidth - panelWidth) / 2;
        map.panBy([point.x - targetX, point.y - window.innerHeight / 2], {
          animate: true,
        });
      }
    });
  }

  function syncExpandButton() {
    const expanded = !isMobile() || els.panel.classList.contains("is-expanded");
    if (!els.panelExpand) return;
    els.panelExpand.setAttribute("aria-expanded", expanded ? "true" : "false");
    els.panelExpand.textContent = expanded ? "簡易表示" : "詳細を見る";
  }

  function expandPanel() {
    els.panel.classList.add("is-expanded");
    els.panel.setAttribute("aria-modal", isMobile() ? "false" : "true");
    syncExpandButton();
  }

  function collapsePanel() {
    els.panel.classList.remove("is-expanded");
    els.panel.setAttribute("aria-modal", "false");
    if (els.panelContent) els.panelContent.scrollTop = 0;
    syncExpandButton();
  }

  function openSpot(spot, shouldPan) {
    lastFocus = document.activeElement;
    els.panelContent.innerHTML = panelHtml(spot);
    bindPanelEvents();
    els.panel.classList.add("is-open");
    els.panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-panel-open");
    els.backdrop.hidden = false;
    if (isMobile()) collapsePanel();
    else expandPanel();
    setActive(spot.id);
    els.panelClose.focus();
    if (shouldPan) panToSpot(spot);
  }

  function closePanel() {
    els.panel.classList.remove("is-open");
    els.panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-panel-open");
    els.backdrop.hidden = true;
    collapsePanel();
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

  function bindSheetGestures() {
    const panel = els.panel;
    if (!panel) return;
    let startY = 0;
    let lastY = 0;
    let tracking = false;

    panel.addEventListener("touchstart", (event) => {
      if (!isMobile() || !panel.classList.contains("is-open")) return;
      const touch = event.touches[0];
      if (!touch) return;
      const expanded = panel.classList.contains("is-expanded");
      const fromChrome = event.target.closest(".side-panel__handle, .panel-peek, .side-panel__expand");
      if (expanded && els.panelContent.scrollTop > 4 && !fromChrome) return;
      startY = touch.clientY;
      lastY = touch.clientY;
      tracking = true;
    }, { passive: true });

    panel.addEventListener("touchmove", (event) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (touch) lastY = touch.clientY;
    }, { passive: true });

    panel.addEventListener("touchend", () => {
      if (!tracking) return;
      tracking = false;
      const dy = lastY - startY;
      if (dy < -48) {
        expandPanel();
      } else if (dy > 48) {
        if (panel.classList.contains("is-expanded")) collapsePanel();
        else closePanel();
      }
    });
  }

  function bindUi() {
    els.panelClose.addEventListener("click", closePanel);
    if (els.panelExpand) {
      els.panelExpand.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isMobile()) return;
        if (els.panel.classList.contains("is-expanded")) collapsePanel();
        else expandPanel();
      });
    }
    bindSheetGestures();
    window.addEventListener("resize", () => {
      if (!els.panel.classList.contains("is-open")) return;
      if (!isMobile()) expandPanel();
      else syncExpandButton();
    });
    els.backdrop.addEventListener("click", closePanel);
    map.on("click", closePanel);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openLegal = document.querySelector(".legal-modal.is-open");
      if (openLegal) {
        closeLegal();
        return;
      }
      if (els.panel.classList.contains("is-open")) closePanel();
    });
    document.querySelectorAll("[data-legal]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openLegal(link.getAttribute("data-legal"));
      });
    });
    document.querySelectorAll("[data-legal-close]").forEach((btn) => {
      btn.addEventListener("click", closeLegal);
    });
    const legalBackdrop = document.getElementById("legal-backdrop");
    if (legalBackdrop) legalBackdrop.addEventListener("click", closeLegal);
    if (location.hash) openLegal(location.hash.replace("#", ""));
    window.addEventListener("hashchange", () => openLegal(location.hash.replace("#", "")));
  }

  function openLegal(id) {
    const modal = document.getElementById(id);
    if (!modal || !modal.classList.contains("legal-modal")) return;
    document.querySelectorAll(".legal-modal").forEach((node) => node.classList.remove("is-open"));
    modal.classList.add("is-open");
    const backdrop = document.getElementById("legal-backdrop");
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("is-legal-open");
  }

  function closeLegal() {
    document.querySelectorAll(".legal-modal").forEach((node) => node.classList.remove("is-open"));
    const backdrop = document.getElementById("legal-backdrop");
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("is-legal-open");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function setHeaderMeta(data) {
    const stamp = formatStamp(data.updatedAt) || formatStamp(new Date().toISOString());
    if (els.mockDate) {
      els.mockDate.textContent = stamp;
      els.mockDate.title = "気象データ・予報データの取得日時";
      if (data.updatedAt) els.mockDate.setAttribute("datetime", data.updatedAt);
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
