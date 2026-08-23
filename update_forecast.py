#!/usr/bin/env python3
"""Build a 16-day stargazing forecast for every spot in spots.json."""

from __future__ import annotations

import json
import math
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
FORECAST_PATH = DATA_DIR / "forecast.json"
FORECAST_JS_PATH = DATA_DIR / "forecast.js"

JST = timezone(timedelta(hours=9), name="JST")
API_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "HoshizoraYosou/1.1 (16-day-forecast)"
SYNODIC_DAYS = 29.530588853
NIGHT_HOURS = (20, 21, 22, 23, 0, 1, 2, 3)
FORECAST_DAYS = 16
SPOT_SLEEP = 0.3
POLLUTION_TO_BORTLE = {"低": 3, "中": 4, "高": 6}


def log(msg: str) -> None:
    print(msg, flush=True)


def open_url(req: urllib.request.Request, timeout: int):
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context())
    except (ssl.SSLError, urllib.error.URLError) as exc:
        reason = str(exc)
        if "CERTIFICATE" not in reason and "SSL" not in reason and not isinstance(exc, ssl.SSLError):
            raise
        return urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context())


def http_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with open_url(req, timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt


def illumination_pct(phase: float) -> int:
    return int(round((1 - math.cos(2 * math.pi * phase)) / 2 * 100))


def moon_age_days(phase: float) -> float:
    return round(phase * SYNODIC_DAYS, 1)


def phase_name(age: float) -> str:
    if age < 1.5 or age >= 28.0:
        return "新月"
    if age < 6.0:
        return "三日月"
    if age < 9.0:
        return "上弦"
    if age < 13.5:
        return "十三夜"
    if age < 16.0:
        return "満月"
    if age < 21.0:
        return "十八夜"
    if age < 24.0:
        return "下弦"
    return "有明月"


def spot_bortle(spot: dict) -> int:
    if spot.get("bortle_scale") is not None:
        try:
            return int(spot["bortle_scale"])
        except (TypeError, ValueError):
            pass
    return POLLUTION_TO_BORTLE.get(str(spot.get("lightPollution", "中")), 4)


def night_dates(now: datetime | None = None) -> list[datetime]:
    now = now or datetime.now(JST)
    start_date = now.date() - timedelta(days=1) if now.hour < 4 else now.date()
    start = datetime(start_date.year, start_date.month, start_date.day, 20, 0, tzinfo=JST)
    return [start + timedelta(days=i) for i in range(FORECAST_DAYS)]


def fetch_open_meteo(lat: float, lng: float) -> dict:
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lng:.4f}",
        "hourly": "cloud_cover",
        "daily": "moon_phase,moonrise,moonset",
        "timezone": "Asia/Tokyo",
        "forecast_days": FORECAST_DAYS,
    }
    return http_json(f"{API_URL}?{urllib.parse.urlencode(params)}")


def hourly_index(api: dict) -> dict[str, int | None]:
    times = api.get("hourly", {}).get("time") or []
    clouds = api.get("hourly", {}).get("cloud_cover") or []
    out = {}
    for stamp, cover in zip(times, clouds):
        out[stamp] = None if cover is None else int(round(float(cover)))
    return out


def daily_moon(api: dict) -> dict[str, dict]:
    days = api.get("daily", {}).get("time") or []
    phases = api.get("daily", {}).get("moon_phase") or []
    rises = api.get("daily", {}).get("moonrise") or [None] * len(days)
    sets = api.get("daily", {}).get("moonset") or [None] * len(days)
    out = {}
    for day, phase, rise, sett in zip(days, phases, rises, sets):
        phase_f = 0.0 if phase is None else float(phase)
        age = moon_age_days(phase_f)
        out[day] = {
            "phase": round(phase_f, 3),
            "age": age,
            "illumination": illumination_pct(phase_f),
            "phaseName": phase_name(age),
            "moonrise": rise,
            "moonset": sett,
        }
    return out


def moon_events(moon_by_day: dict) -> list[tuple[datetime, str]]:
    events = []
    for row in moon_by_day.values():
        rise = parse_iso(row.get("moonrise"))
        sett = parse_iso(row.get("moonset"))
        if rise:
            events.append((rise, "rise"))
        if sett:
            events.append((sett, "set"))
    events.sort(key=lambda item: item[0])
    return events


def moon_is_up(moment: datetime, events: list[tuple[datetime, str]]) -> bool:
    state = False
    for when, kind in events:
        if when <= moment:
            state = kind == "rise"
        else:
            break
    return state


def night_hours(night_start: datetime) -> list[datetime]:
    hours = []
    for offset in range(8):
        hour = night_start + timedelta(hours=offset)
        if hour.hour in NIGHT_HOURS:
            hours.append(hour)
    return hours


def score_night(avg_cloud: float, illum: int, moon_down_ratio: float, bortle: int) -> tuple[int, int, str]:
    cloud_pts = 50 * (1 - max(0.0, min(100.0, avg_cloud)) / 100.0)
    moon_pts = 28 * (1 - illum / 100.0) + 12 * moon_down_ratio
    bortle_pts = max(0.0, 20 - max(1, bortle - 1) * 3)
    score100 = int(round(max(0.0, min(100.0, cloud_pts + moon_pts + bortle_pts))))
    if score100 >= 80:
        stars, label = 5, "観測・撮影ともに適"
    elif score100 >= 62:
        stars, label = 4, "観測向き"
    elif score100 >= 44:
        stars, label = 3, "条件つき可"
    elif score100 >= 26:
        stars, label = 2, "やや不良"
    else:
        stars, label = 1, "不向き"
    if moon_down_ratio < 0.25 and illum >= 70 and stars >= 3:
        label = "月明かり注意"
    if avg_cloud <= 25 and moon_down_ratio >= 0.6 and stars >= 4:
        label = "新月級・観測適"
    return stars, score100, label


def build_daily(api: dict, night_starts: list[datetime], bortle: int) -> list[dict]:
    clouds = hourly_index(api)
    moon_by_day = daily_moon(api)
    events = moon_events(moon_by_day)
    rows = []
    for index, start in enumerate(night_starts):
        day_key = start.date().isoformat()
        moon = moon_by_day.get(day_key) or {
            "phase": 0,
            "age": 0,
            "illumination": 50,
            "phaseName": "—",
            "moonrise": None,
            "moonset": None,
        }
        hourly = []
        covers = []
        down = 0
        for hour in night_hours(start):
            stamp = hour.strftime("%Y-%m-%dT%H:00")
            cover = clouds.get(stamp)
            if cover is None:
                continue
            covers.append(cover)
            up = moon_is_up(hour, events)
            if not up:
                down += 1
            hourly.append(
                {
                    "time": stamp,
                    "hour": f"{hour.hour:02d}:00",
                    "cloudCover": cover,
                    "moonUp": up,
                }
            )
        if not covers:
            continue
        avg = int(round(sum(covers) / len(covers)))
        down_ratio = down / max(1, len(hourly))
        stars, score100, label = score_night(avg, moon["illumination"], down_ratio, bortle)
        row = {
            "date": day_key,
            "offset": index,
            "starScore": stars,
            "score100": score100,
            "label": label,
            "cloudCover": avg,
            "moonAge": moon["age"],
            "moonIllumination": moon["illumination"],
            "moonPhase": moon["phase"],
            "moonPhaseName": moon["phaseName"],
            "moonrise": moon.get("moonrise"),
            "moonset": moon.get("moonset"),
            "moonDownHours": down,
            "moonDownRatio": round(down_ratio, 2),
        }
        if index < 7:
            row["hourlyCloud"] = hourly
        rows.append(row)
    return rows


def load_spots() -> list[dict]:
    data = json.loads(SPOTS_PATH.read_text(encoding="utf-8"))
    spots = data.get("spots") or []
    if not spots:
        raise RuntimeError("spots.json に spots がありません")
    return spots


def to_output_spot(spot: dict, daily: list[dict]) -> dict:
    tonight = daily[0] if daily else {}
    lat = float(spot["lat"])
    lng = float(spot.get("lng", spot.get("lon")))
    elevation = int(round(float(spot.get("elevation", spot.get("elevation_m", 0)))))
    return {
        "id": spot["id"],
        "name": spot["name"],
        "subtitle": spot.get("subtitle", ""),
        "prefecture": spot.get("prefecture", ""),
        "lat": lat,
        "lng": lng,
        "lon": lng,
        "elevation": elevation,
        "elevation_m": elevation,
        "lightPollution": spot.get("lightPollution", ""),
        "bortle_scale": spot_bortle(spot),
        "description": spot.get("description", ""),
        "starScore": tonight.get("starScore", spot.get("starScore", 3)),
        "condition": {
            "label": tonight.get("label", "判定なし"),
            "cloudCover": tonight.get("cloudCover", 0),
            "moonPhase": tonight.get("moonPhaseName", "—"),
            "moonIllumination": tonight.get("moonIllumination", 0),
            "moonAge": tonight.get("moonAge", 0),
        },
        "hourlyCloud": tonight.get("hourlyCloud", []),
        "daily": daily,
    }


def write_outputs(payload: dict) -> None:
    FORECAST_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    FORECAST_JS_PATH.write_text(
        "window.HOSHIZORA_DATA = window.HOSHIZORA_DATA || {};\n"
        "window.HOSHIZORA_DATA.forecast = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    log(f"wrote {FORECAST_PATH}")
    log(f"wrote {FORECAST_JS_PATH}")


def main() -> int:
    spots = load_spots()
    nights = night_dates()
    generated = datetime.now(JST)
    out_spots = []
    errors = []
    for index, spot in enumerate(spots, 1):
        name = spot.get("name", spot.get("id"))
        try:
            lat = float(spot["lat"])
            lng = float(spot.get("lng", spot.get("lon")))
            api = fetch_open_meteo(lat, lng)
            daily = build_daily(api, nights, spot_bortle(spot))
            if not daily:
                raise RuntimeError("夜間雲量が空です")
            out_spots.append(to_output_spot(spot, daily))
            tonight = daily[0]
            log(
                f"[{index}/{len(spots)}] {name}: "
                f"★{tonight['starScore']} {tonight['score100']}点 雲量{tonight['cloudCover']}%"
            )
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            log(f"[{index}/{len(spots)}] {name}: ERROR {exc}")
        if index < len(spots):
            time.sleep(SPOT_SLEEP)

    if not out_spots:
        log("ERROR: 予報を1件も作れませんでした")
        return 1

    payload = {
        "updatedAt": generated.isoformat(timespec="seconds"),
        "source": "Open-Meteo",
        "forecastDays": FORECAST_DAYS,
        "nightWindow": {
            "startHour": 20,
            "endHour": 3,
            "nights": [n.date().isoformat() for n in nights],
        },
        "spots": out_spots,
        "errors": errors,
    }
    write_outputs(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
