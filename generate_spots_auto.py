#!/usr/bin/env python3
"""Collect stargazing-friendly public spots from OSM Overpass and GSI elevation."""

from __future__ import annotations

import argparse
import json
import math
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SPOTS_PATH = DATA_DIR / "spots.json"
AUTO_PATH = DATA_DIR / "auto_spots.json"
AUTO_JS_PATH = DATA_DIR / "auto_spots.js"
ELEV_CACHE_PATH = DATA_DIR / "elevation_cache.json"

JST = timezone(timedelta(hours=9), name="JST")
USER_AGENT = "HoshizoraYosou/1.0 (stargazing-map; OSM/GSI)"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
GSI_ELEVATION_URL = (
    "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php"
)
GSI_ELEVATION_FALLBACK = "https://cyberjapandata2.gsi.go.jp/elevation/value"

PREFECTURES = [
    ("JP-01", "北海道"),
    ("JP-02", "青森県"),
    ("JP-03", "岩手県"),
    ("JP-04", "宮城県"),
    ("JP-05", "秋田県"),
    ("JP-06", "山形県"),
    ("JP-07", "福島県"),
    ("JP-08", "茨城県"),
    ("JP-09", "栃木県"),
    ("JP-10", "群馬県"),
    ("JP-11", "埼玉県"),
    ("JP-12", "千葉県"),
    ("JP-13", "東京都"),
    ("JP-14", "神奈川県"),
    ("JP-15", "新潟県"),
    ("JP-16", "富山県"),
    ("JP-17", "石川県"),
    ("JP-18", "福井県"),
    ("JP-19", "山梨県"),
    ("JP-20", "長野県"),
    ("JP-21", "岐阜県"),
    ("JP-22", "静岡県"),
    ("JP-23", "愛知県"),
    ("JP-24", "三重県"),
    ("JP-25", "滋賀県"),
    ("JP-26", "京都府"),
    ("JP-27", "大阪府"),
    ("JP-28", "兵庫県"),
    ("JP-29", "奈良県"),
    ("JP-30", "和歌山県"),
    ("JP-31", "鳥取県"),
    ("JP-32", "島根県"),
    ("JP-33", "岡山県"),
    ("JP-34", "広島県"),
    ("JP-35", "山口県"),
    ("JP-36", "徳島県"),
    ("JP-37", "香川県"),
    ("JP-38", "愛媛県"),
    ("JP-39", "高知県"),
    ("JP-40", "福岡県"),
    ("JP-41", "佐賀県"),
    ("JP-42", "長崎県"),
    ("JP-43", "熊本県"),
    ("JP-44", "大分県"),
    ("JP-45", "宮崎県"),
    ("JP-46", "鹿児島県"),
    ("JP-47", "沖縄県"),
]

VIEWPOINT_MIN_M = 200
DEDUP_METERS = 180
OVERPASS_SLEEP = 0.5
ELEVATION_SLEEP = 0.5


def log(msg: str) -> None:
    print(msg, flush=True)


def now_jst() -> datetime:
    return datetime.now(JST)


def open_url(req: urllib.request.Request, timeout: int):
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context())
    except (ssl.SSLError, urllib.error.URLError) as exc:
        reason = str(exc)
        if "CERTIFICATE" not in reason and "SSL" not in reason and not isinstance(exc, ssl.SSLError):
            raise
        ctx = ssl._create_unverified_context()
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def http_json(url: str, data: bytes | None = None, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="POST" if data is not None else "GET",
    )
    with open_url(req, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def overpass_query(iso_code: str) -> str:
    return f"""
[out:json][timeout:90];
area["ISO3166-2"="{iso_code}"]->.a;
(
  nwr["tourism"="viewpoint"](area.a);
  nwr["highway"="rest_area"](area.a);
  nwr["highway"="services"](area.a);
);
out center tags;
""".strip()


def fetch_overpass(iso_code: str) -> dict:
    payload = urllib.parse.urlencode({"data": overpass_query(iso_code)}).encode("utf-8")
    last_error = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                return http_json(endpoint, data=payload, timeout=120)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{iso_code}: Overpass failed ({last_error})")


def element_name(tags: dict) -> str:
    for key in ("name:ja", "name", "name:en"):
        value = (tags.get(key) or "").strip()
        if value:
            return value
    return ""


def element_coords(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def truthy_tag(*values: str) -> bool:
    yes = {"yes", "true", "1", "public", "ok"}
    return any(str(v).strip().lower() in yes for v in values if v)


def classify(tags: dict) -> str | None:
    name = element_name(tags)
    highway = tags.get("highway", "")
    if tags.get("tourism") == "viewpoint":
        return "viewpoint"
    if highway in {"rest_area", "services"} and "道の駅" in name:
        return "michinoeki"
    return None


def slug_id(kind: str, osm_type: str, osm_id: int) -> str:
    prefix = "n" if osm_type == "node" else "w" if osm_type == "way" else "r"
    return f"{kind}-{prefix}{osm_id}"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_cache() -> dict:
    if not ELEV_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(ELEV_CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_cache(cache: dict) -> None:
    ELEV_CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def cache_key(lat: float, lon: float) -> str:
    return f"{lat:.5f},{lon:.5f}"


def fetch_elevation(lat: float, lon: float) -> float | None:
    params = urllib.parse.urlencode({"lon": f"{lon:.6f}", "lat": f"{lat:.6f}", "outtype": "JSON"})
    urls = [
        f"{GSI_ELEVATION_URL}?{params}",
        f"{GSI_ELEVATION_FALLBACK}?lon={lon:.6f}&lat={lat:.6f}",
    ]
    for url in urls:
        try:
            data = http_json(url, timeout=20)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            continue
        elevation = data.get("elevation")
        if isinstance(elevation, (int, float)):
            return float(elevation)
    return None


def bortle_scale(elevation_m: float) -> int:
    return 3 if elevation_m >= 800 else 4


def winter_closure(elevation_m: float) -> bool:
    return elevation_m >= 1000


def build_description(kind: str, name: str, prefecture: str, elevation_m: int) -> str:
    place = prefecture or "日本"
    if kind == "michinoeki":
        return (
            f"{place}の道の駅「{name}」。駐車場とトイレが使いやすく、"
            f"標高約{elevation_m}mの公共スポットとして星空観測の拠点になります。"
        )
    return (
        f"{place}の展望台「{name}」。標高約{elevation_m}mで見晴らしがよく、"
        "街明かりから少し離れた観測ポイントとして利用できます。"
    )


def to_spot(kind: str, prefecture: str, el: dict, elevation_m: int) -> dict:
    tags = el.get("tags") or {}
    name = element_name(tags)
    lat, lon = element_coords(el)
    toilets = truthy_tag(tags.get("toilets")) or tags.get("amenity") == "toilets"
    parking = truthy_tag(tags.get("parking")) or tags.get("amenity") == "parking"
    is_24h = "24/7" in str(tags.get("opening_hours", ""))
    if kind == "michinoeki":
        toilets = True
        parking = True
        is_24h = True
    notes = []
    if winter_closure(elevation_m):
        notes.append("標高1000m以上のため、冬季は閉鎖・積雪に注意。")
    notes.append("OpenStreetMapと国土地理院標高APIから自動抽出。")
    return {
        "id": slug_id(kind, el["type"], int(el["id"])),
        "name": name,
        "prefecture": prefecture,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "elevation_m": elevation_m,
        "bortle_scale": bortle_scale(elevation_m),
        "is_24h": bool(is_24h),
        "has_toilet": bool(toilets) if kind == "viewpoint" else True,
        "has_parking": True if kind == "michinoeki" else bool(parking),
        "winter_closure": winter_closure(elevation_m),
        "description": build_description(kind, name, prefecture, elevation_m),
        "notes": " ".join(notes),
        "affiliate_keyword": re.sub(r"\s+", " ", name).strip(),
        "category": "道の駅" if kind == "michinoeki" else "展望台",
        "source": "osm+gsi",
    }


def legacy_to_spot(raw: dict) -> dict:
    lat = float(raw["lat"])
    lon = float(raw.get("lon", raw.get("lng")))
    elevation_m = int(round(float(raw.get("elevation_m", raw.get("elevation", 0)))))
    light = str(raw.get("lightPollution", "低"))
    bortle = 3 if light == "低" else 4 if light == "中" else 5
    return {
        "id": raw["id"],
        "name": raw["name"],
        "prefecture": raw.get("prefecture", ""),
        "lat": lat,
        "lon": lon,
        "elevation_m": elevation_m,
        "bortle_scale": raw.get("bortle_scale", bortle),
        "is_24h": bool(raw.get("is_24h", False)),
        "has_toilet": bool(raw.get("has_toilet", True)),
        "has_parking": bool(raw.get("has_parking", True)),
        "winter_closure": bool(raw.get("winter_closure", winter_closure(elevation_m))),
        "description": raw.get("description", ""),
        "notes": raw.get("notes", "手動登録の主要観測地。"),
        "affiliate_keyword": raw.get("affiliate_keyword", raw["name"]),
        "category": raw.get("category", "主要地"),
        "source": "curated",
        "subtitle": raw.get("subtitle", ""),
    }


def nearby(existing: list[dict], lat: float, lon: float) -> bool:
    return any(haversine_m(lat, lon, s["lat"], s["lon"]) < DEDUP_METERS for s in existing)


def collect_candidates(prefecture_codes: set[str]) -> list[dict]:
    collected = []
    selected = [row for row in PREFECTURES if row[0] in prefecture_codes]
    for index, (code, prefecture) in enumerate(selected, 1):
        log(f"[{index}/{len(selected)}] Overpass {prefecture} ({code})")
        try:
            payload = fetch_overpass(code)
        except RuntimeError as exc:
            log(f"  skip: {exc}")
            continue
        elements = payload.get("elements") or []
        kept = 0
        for el in elements:
            tags = el.get("tags") or {}
            name = element_name(tags)
            if not name:
                continue
            kind = classify(tags)
            if not kind:
                continue
            coords = element_coords(el)
            if not coords:
                continue
            collected.append(
                {
                    "kind": kind,
                    "prefecture": prefecture,
                    "element": el,
                    "lat": coords[0],
                    "lon": coords[1],
                    "name": name,
                }
            )
            kept += 1
        log(f"  elements={len(elements)} named_keep={kept}")
        if index < len(selected):
            time.sleep(OVERPASS_SLEEP)
    return collected


def enrich_elevation(candidates: list[dict]) -> list[dict]:
    cache = load_cache()
    spots = []
    total = len(candidates)
    for index, item in enumerate(candidates, 1):
        key = cache_key(item["lat"], item["lon"])
        elevation = cache.get(key)
        if not isinstance(elevation, (int, float)):
            elevation = fetch_elevation(item["lat"], item["lon"])
            if elevation is not None:
                cache[key] = round(float(elevation), 1)
            time.sleep(ELEVATION_SLEEP)
        if not isinstance(elevation, (int, float)):
            log(f"  no elevation: {item['name']}")
            continue
        elevation_m = int(round(float(elevation)))
        if item["kind"] == "viewpoint" and elevation_m < VIEWPOINT_MIN_M:
            continue
        spots.append(to_spot(item["kind"], item["prefecture"], item["element"], elevation_m))
        if index % 20 == 0 or index == total:
            log(f"  elevation {index}/{total}")
            save_cache(cache)
    save_cache(cache)
    return spots


def merge_spots(auto_spots: list[dict], curated: list[dict]) -> list[dict]:
    merged = []
    for spot in curated + auto_spots:
        if nearby(merged, spot["lat"], spot["lon"]):
            continue
        if any(s["id"] == spot["id"] or s["name"] == spot["name"] for s in merged):
            continue
        merged.append(spot)
    merged.sort(key=lambda s: (-s["elevation_m"], s["prefecture"], s["name"]))
    return merged


def load_curated() -> list[dict]:
    if not SPOTS_PATH.exists():
        return []
    data = json.loads(SPOTS_PATH.read_text(encoding="utf-8"))
    return [legacy_to_spot(s) for s in data.get("spots") or []]


def write_outputs(payload: dict) -> None:
    AUTO_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    AUTO_JS_PATH.write_text(
        "window.HOSHIZORA_DATA = window.HOSHIZORA_DATA || {};\n"
        "window.HOSHIZORA_DATA.autoSpots = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    log(f"wrote {AUTO_PATH} ({len(payload['spots'])} spots)")
    log(f"wrote {AUTO_JS_PATH} (file:// fallback)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OSMと国土地理院から観測スポットを自動収集します")
    parser.add_argument(
        "--prefectures",
        default="",
        help="対象のISOコードをカンマ区切り（例: JP-20,JP-29）。空なら全国",
    )
    parser.add_argument("--max-spots", type=int, default=0, help="標高取得前の上限（0は無制限）")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.prefectures.strip():
        codes = {c.strip().upper() for c in args.prefectures.split(",") if c.strip()}
    else:
        codes = {code for code, _ in PREFECTURES}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    candidates = collect_candidates(codes)
    unique = []
    seen = set()
    for item in candidates:
        key = (item["name"], round(item["lat"], 4), round(item["lon"], 4))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    if args.max_spots and len(unique) > args.max_spots:
        unique = unique[: args.max_spots]
    log(f"candidates after dedup: {len(unique)}")

    auto_spots = enrich_elevation(unique)
    curated = load_curated()
    merged = merge_spots(auto_spots, curated)
    payload = {
        "updatedAt": now_jst().isoformat(timespec="seconds"),
        "source": "OpenStreetMap Overpass + GSI elevation",
        "note": "自動抽出した公共スポットです。予報スコアは update_forecast.py で付与します。",
        "counts": {
            "osm_candidates": len(unique),
            "after_filter": len(auto_spots),
            "merged": len(merged),
            "curated": len(curated),
        },
        "spots": merged,
    }
    write_outputs(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
