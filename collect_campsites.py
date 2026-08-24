#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Collect stargazing-friendly campsites from OSM Overpass and GSI elevation."""

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
OSM_CACHE_PATH = DATA_DIR / "campsite_osm_cache.json"

JST = timezone(timedelta(hours=9), name="JST")
USER_AGENT = "HoshizoraYosou/1.0 (campsite-collect; OSM/GSI)"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
GSI_ELEVATION_VALUE = "https://cyberjapandata2.gsi.go.jp/elevation/value"
GSI_ELEVATION_PHP = (
    "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php"
)

PREFECTURES = [
    ("JP-01", "北海道"), ("JP-02", "青森県"), ("JP-03", "岩手県"), ("JP-04", "宮城県"),
    ("JP-05", "秋田県"), ("JP-06", "山形県"), ("JP-07", "福島県"), ("JP-08", "茨城県"),
    ("JP-09", "栃木県"), ("JP-10", "群馬県"), ("JP-11", "埼玉県"), ("JP-12", "千葉県"),
    ("JP-13", "東京都"), ("JP-14", "神奈川県"), ("JP-15", "新潟県"), ("JP-16", "富山県"),
    ("JP-17", "石川県"), ("JP-18", "福井県"), ("JP-19", "山梨県"), ("JP-20", "長野県"),
    ("JP-21", "岐阜県"), ("JP-22", "静岡県"), ("JP-23", "愛知県"), ("JP-24", "三重県"),
    ("JP-25", "滋賀県"), ("JP-26", "京都府"), ("JP-27", "大阪府"), ("JP-28", "兵庫県"),
    ("JP-29", "奈良県"), ("JP-30", "和歌山県"), ("JP-31", "鳥取県"), ("JP-32", "島根県"),
    ("JP-33", "岡山県"), ("JP-34", "広島県"), ("JP-35", "山口県"), ("JP-36", "徳島県"),
    ("JP-37", "香川県"), ("JP-38", "愛媛県"), ("JP-39", "高知県"), ("JP-40", "福岡県"),
    ("JP-41", "佐賀県"), ("JP-42", "長崎県"), ("JP-43", "熊本県"), ("JP-44", "大分県"),
    ("JP-45", "宮崎県"), ("JP-46", "鹿児島県"), ("JP-47", "沖縄県"),
]

MIN_ELEVATION_M = 200
DEDUP_METERS = 500
OVERPASS_SLEEP = 0.7
ELEVATION_SLEEP = 0.35


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
        return urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context())


def http_json(url: str, data: bytes | None = None, timeout: int = 90):
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain"},
        method="POST" if data is not None else "GET",
    )
    with open_url(req, timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def overpass_query(iso_code: str) -> str:
    return f"""
[out:json][timeout:90];
area["ISO3166-2"="{iso_code}"]->.a;
(
  node["tourism"="camp_site"]["name"](area.a);
  way["tourism"="camp_site"]["name"](area.a);
);
out center tags;
""".strip()


def fetch_overpass(iso_code: str) -> dict:
    payload = urllib.parse.urlencode({"data": overpass_query(iso_code)}).encode("utf-8")
    last_error = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                data = http_json(endpoint, data=payload, timeout=120)
                if isinstance(data, dict):
                    return data
                last_error = RuntimeError("non-json overpass response")
            except Exception as exc:
                last_error = exc
                time.sleep(2.0 * (attempt + 1))
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


def truthy_tag(*values: object) -> bool:
    yes = {"yes", "true", "1", "public", "ok", "customers", "named"}
    return any(str(v).strip().lower() in yes for v in values if v is not None and str(v).strip())


def slug_id(osm_type: str, osm_id: int) -> str:
    prefix = "n" if osm_type == "node" else "w" if osm_type == "way" else "r"
    return f"camp_site-{prefix}{osm_id}"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def normalize_name(name: str) -> str:
    text = re.sub(r"\s+", "", str(name or ""))
    table = str.maketrans("０１２３４５６７８９　", "0123456789 ")
    return text.translate(table).casefold()


def spot_latlon(spot: dict) -> tuple[float, float] | None:
    try:
        lat = float(spot.get("lat"))
        lon = float(spot.get("lon", spot.get("lng")))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lon):
        return None
    return lat, lon


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_cache() -> dict:
    data = load_json(ELEV_CACHE_PATH)
    return data if isinstance(data, dict) else {}


def save_cache(cache: dict) -> None:
    ELEV_CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def cache_key(lat: float, lon: float) -> str:
    return f"{lat:.5f},{lon:.5f}"


def parse_elevation(payload) -> float | None:
    if payload is None:
        return None
    if isinstance(payload, (int, float)):
        value = float(payload)
        return value if math.isfinite(value) and value > -100 else None
    if isinstance(payload, str):
        try:
            value = float(payload.split()[0])
        except (TypeError, ValueError, IndexError):
            return None
        return value if math.isfinite(value) and value > -100 else None
    if isinstance(payload, dict):
        for key in ("elevation", "h", "height", "value"):
            if key in payload:
                parsed = parse_elevation(payload.get(key))
                if parsed is not None:
                    return parsed
    return None


def fetch_elevation(lat: float, lon: float) -> float | None:
    urls = [
        f"{GSI_ELEVATION_VALUE}?lon={lon:.6f}&lat={lat:.6f}",
        f"{GSI_ELEVATION_PHP}?{urllib.parse.urlencode({'lon': f'{lon:.6f}', 'lat': f'{lat:.6f}', 'outtype': 'JSON'})}",
    ]
    for url in urls:
        try:
            payload = http_json(url, timeout=20)
        except (urllib.error.URLError, TimeoutError):
            continue
        elevation = parse_elevation(payload)
        if elevation is not None:
            return elevation
    return None


def bortle_scale(elevation_m: float) -> int:
    if elevation_m >= 1200:
        return 2
    if elevation_m >= 700:
        return 3
    if elevation_m >= 300:
        return 4
    return 5


def light_from_bortle(bortle: int) -> str:
    if bortle <= 3:
        return "低"
    if bortle == 4:
        return "中"
    return "高"


def winter_closure(elevation_m: float) -> bool:
    return elevation_m >= 1000


def build_description(name: str, prefecture: str, elevation_m: int, bortle: int) -> str:
    place = prefecture or "日本"
    dark = "市街地の光から離れやすく、星空観測のキャンプ適地です。"
    if bortle <= 2:
        dark = "標高が高く空が暗い傾向で、天の川観測にも向きます。"
    elif bortle == 3:
        dark = "山地キャンプ場として、街明かりを避けた観測が期待できます。"
    return (
        f"{place}のキャンプ場「{name}」。標高約{elevation_m}m、"
        f"光害の目安は Bortle {bortle} 相当です。{dark}"
        "テントサイトの照明・焚き火・門扉の時間は現地案内を優先してください。"
    )


def to_spot(prefecture: str, el: dict, elevation_m: int) -> dict:
    tags = el.get("tags") or {}
    name = element_name(tags)
    lat, lon = element_coords(el)
    toilets = truthy_tag(tags.get("toilets"), tags.get("toilets:disposal")) or tags.get("amenity") == "toilets"
    parking = truthy_tag(tags.get("parking")) or tags.get("amenity") == "parking"
    is_24h = "24/7" in str(tags.get("opening_hours", ""))
    bortle = bortle_scale(elevation_m)
    winter = winter_closure(elevation_m)
    notes = ["OpenStreetMap の tourism=camp_site と国土地理院標高APIから自動抽出。"]
    if winter:
        notes.insert(0, "標高1000m以上のため、冬季は閉鎖・積雪に注意。")
    description = build_description(name, prefecture, elevation_m, bortle)
    return {
        "id": slug_id(str(el.get("type", "node")), int(el["id"])),
        "name": name,
        "category": "camp_site",
        "subtitle": "キャンプ場",
        "prefecture": prefecture,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "lng": round(lon, 6),
        "elevation": elevation_m,
        "elevation_m": elevation_m,
        "bortle_scale": bortle,
        "lightPollution": light_from_bortle(bortle),
        "is_24h": bool(is_24h),
        "has_toilet": bool(toilets),
        "has_parking": bool(parking),
        "winter_closure": winter,
        "description": description,
        "overview": description,
        "notes": " ".join(notes),
        "affiliate_keyword": re.sub(r"\s+", " ", name).strip(),
        "source": "osm-camp+gsi",
    }


def existing_reference_spots() -> list[dict]:
    refs = []
    for path in (SPOTS_PATH, AUTO_PATH):
        data = load_json(path)
        for spot in data.get("spots") or []:
            if spot.get("category") == "camp_site":
                continue
            refs.append(spot)
    return refs


def is_duplicate(name: str, lat: float, lon: float, refs: list[dict], extra: list[dict] | None = None) -> str | None:
    if "道の駅" in name:
        return "name_michinoeki"
    key = normalize_name(name)
    pool = list(refs)
    if extra:
        pool.extend(extra)
    for spot in pool:
        if normalize_name(spot.get("name", "")) == key:
            return "name_exact"
        coords = spot_latlon(spot)
        if coords and haversine_m(lat, lon, coords[0], coords[1]) <= DEDUP_METERS:
            return "distance_500m"
    return None


def collect_candidates(prefecture_codes: set[str], refresh: bool = False) -> list[dict]:
    collected = []
    osm_cache = load_json(OSM_CACHE_PATH)
    if not isinstance(osm_cache, dict):
        osm_cache = {}
    selected = [row for row in PREFECTURES if row[0] in prefecture_codes]
    for index, (code, prefecture) in enumerate(selected, 1):
        cached = osm_cache.get(code) if not refresh else None
        if isinstance(cached, list):
            log(f"[{index}/{len(selected)}] cache {prefecture} ({code}) n={len(cached)}")
            collected.extend(cached)
            continue
        log(f"[{index}/{len(selected)}] Overpass {prefecture} ({code})")
        try:
            payload = fetch_overpass(code)
        except Exception as exc:
            log(f"  skip: {exc}")
            continue
        elements = payload.get("elements") or []
        kept_items = []
        for el in elements:
            if el.get("type") not in {"node", "way"}:
                continue
            tags = el.get("tags") or {}
            name = element_name(tags)
            if not name:
                continue
            coords = element_coords(el)
            if not coords:
                continue
            item = {
                "prefecture": prefecture,
                "element": {
                    "type": el.get("type"),
                    "id": el.get("id"),
                    "lat": coords[0],
                    "lon": coords[1],
                    "tags": tags,
                    "center": {"lat": coords[0], "lon": coords[1]},
                },
                "lat": coords[0],
                "lon": coords[1],
                "name": name,
            }
            kept_items.append(item)
        osm_cache[code] = kept_items
        OSM_CACHE_PATH.write_text(json.dumps(osm_cache, ensure_ascii=False) + "\n", encoding="utf-8")
        collected.extend(kept_items)
        log(f"  elements={len(elements)} named={len(kept_items)}")
        if index < len(selected):
            time.sleep(OVERPASS_SLEEP)

    missing = [row for row in selected if row[0] not in osm_cache]
    if missing:
        log(f"retry Overpass for {len(missing)} prefectures")
        time.sleep(8)
        for index, (code, prefecture) in enumerate(missing, 1):
            log(f"[retry {index}/{len(missing)}] Overpass {prefecture} ({code})")
            try:
                payload = fetch_overpass(code)
            except Exception as exc:
                log(f"  skip: {exc}")
                continue
            elements = payload.get("elements") or []
            kept_items = []
            for el in elements:
                if el.get("type") not in {"node", "way"}:
                    continue
                tags = el.get("tags") or {}
                name = element_name(tags)
                if not name:
                    continue
                coords = element_coords(el)
                if not coords:
                    continue
                kept_items.append(
                    {
                        "prefecture": prefecture,
                        "element": {
                            "type": el.get("type"),
                            "id": el.get("id"),
                            "lat": coords[0],
                            "lon": coords[1],
                            "tags": tags,
                            "center": {"lat": coords[0], "lon": coords[1]},
                        },
                        "lat": coords[0],
                        "lon": coords[1],
                        "name": name,
                    }
                )
            osm_cache[code] = kept_items
            OSM_CACHE_PATH.write_text(json.dumps(osm_cache, ensure_ascii=False) + "\n", encoding="utf-8")
            collected.extend(kept_items)
            log(f"  elements={len(elements)} named={len(kept_items)}")
            time.sleep(OVERPASS_SLEEP + 1)
    return collected


def enrich_elevation(candidates: list[dict], refs: list[dict]) -> tuple[list[dict], dict]:
    cache = load_cache()
    spots = []
    stats = {
        "candidates": len(candidates),
        "name_michinoeki": 0,
        "name_exact": 0,
        "distance_500m": 0,
        "low_elevation": 0,
        "no_elevation": 0,
        "kept": 0,
    }
    total = len(candidates)
    for index, item in enumerate(candidates, 1):
        reason = is_duplicate(item["name"], item["lat"], item["lon"], refs, spots)
        if reason:
            stats[reason] = stats.get(reason, 0) + 1
            continue
        key = cache_key(item["lat"], item["lon"])
        elevation = cache.get(key)
        if not isinstance(elevation, (int, float)):
            elevation = fetch_elevation(item["lat"], item["lon"])
            if elevation is not None:
                cache[key] = round(float(elevation), 1)
            time.sleep(ELEVATION_SLEEP)
        if not isinstance(elevation, (int, float)):
            stats["no_elevation"] += 1
            continue
        elevation_m = int(round(float(elevation)))
        if elevation_m < MIN_ELEVATION_M:
            stats["low_elevation"] += 1
            continue
        spots.append(to_spot(item["prefecture"], item["element"], elevation_m))
        stats["kept"] += 1
        if index % 25 == 0 or index == total:
            log(f"  elevation {index}/{total} kept={stats['kept']}")
            save_cache(cache)
    save_cache(cache)
    return spots, stats


def merge_into_spots_json(camps: list[dict]) -> int:
    data = load_json(SPOTS_PATH)
    existing = list(data.get("spots") or [])
    by_id = {s.get("id") for s in existing}
    added = 0
    for camp in camps:
        if camp["id"] in by_id:
            continue
        if is_duplicate(camp["name"], camp["lat"], camp["lon"], existing):
            continue
        existing.append(camp)
        by_id.add(camp["id"])
        added += 1
    data["spots"] = existing
    data["updatedAt"] = now_jst().isoformat(timespec="seconds")
    data["note"] = data.get("note") or ""
    SPOTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added


def merge_into_auto_spots(camps: list[dict]) -> int:
    if not AUTO_PATH.exists():
        return 0
    data = load_json(AUTO_PATH)
    existing = list(data.get("spots") or [])
    by_id = {s.get("id") for s in existing}
    added = 0
    for camp in camps:
        if camp["id"] in by_id:
            continue
        if is_duplicate(camp["name"], camp["lat"], camp["lon"], existing):
            continue
        existing.append(camp)
        by_id.add(camp["id"])
        added += 1
    existing.sort(key=lambda s: (-float(s.get("elevation_m", s.get("elevation", 0)) or 0), s.get("prefecture", ""), s.get("name", "")))
    data["spots"] = existing
    data["updatedAt"] = now_jst().isoformat(timespec="seconds")
    counts = data.get("counts") if isinstance(data.get("counts"), dict) else {}
    counts["campsites"] = sum(1 for s in existing if s.get("category") == "camp_site")
    counts["merged"] = len(existing)
    data["counts"] = counts
    AUTO_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    AUTO_JS_PATH.write_text(
        "window.HOSHIZORA_DATA = window.HOSHIZORA_DATA || {};\n"
        "window.HOSHIZORA_DATA.autoSpots = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    return added


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="全国のキャンプ場を収集し spots.json にマージします")
    parser.add_argument(
        "--prefectures",
        default="",
        help="対象のISOコードをカンマ区切り（例: JP-20,JP-29）。空なら全国",
    )
    parser.add_argument("--max-candidates", type=int, default=0, help="標高取得前の上限（0は無制限）")
    parser.add_argument("--refresh-osm", action="store_true", help="Overpassキャッシュを使わず再取得")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.prefectures.strip():
        codes = {c.strip().upper() for c in args.prefectures.split(",") if c.strip()}
    else:
        codes = {code for code, _ in PREFECTURES}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    refs = existing_reference_spots()
    log(f"reference spots (excluding existing camps): {len(refs)}")
    candidates = collect_candidates(codes, refresh=args.refresh_osm)
    unique = []
    seen = set()
    for item in candidates:
        key = (normalize_name(item["name"]), round(item["lat"], 4), round(item["lon"], 4))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    if args.max_candidates and len(unique) > args.max_candidates:
        unique = unique[: args.max_candidates]
    log(f"candidates after osm dedup: {len(unique)}")
    camps, stats = enrich_elevation(unique, refs)
    added_spots = merge_into_spots_json(camps)
    added_auto = merge_into_auto_spots(camps)
    log(f"stats {json.dumps(stats, ensure_ascii=False)}")
    log(f"camps kept={len(camps)} added_to_spots.json={added_spots} added_to_auto_spots={added_auto}")
    return 0


if __name__ == "__main__":
    sys.exit(main())