"""Anki Buddy Board.

Reads your review history (counts and times only, never card contents) and
uploads it as data/<name>.json to a shared GitHub repo, where the Buddy Board
website picks it up.

Uploads happen automatically after an AnkiWeb sync, when you leave the review
screen, and when you close your profile. Tools > "Upload stats to Buddy Board"
forces one.
"""

import base64
import datetime
import hashlib
import json
import os
import re
import time

try:
    from aqt import gui_hooks, mw
    from aqt.qt import QAction
    from aqt.utils import showWarning, tooltip
except ImportError:  # imported outside Anki, e.g. by the tests
    mw = None

SCHEMA = 1
STATE_FILE = os.path.join(os.path.dirname(__file__), "user_files", "last_upload.json")

# Manual reschedules (type 4/5) and "forget" entries (ease 0) aren't reviews.
REAL_REVIEW = "type < 4 and ease > 0"

DAY_SQL = f"""
select date(id / 1000, 'unixepoch', 'localtime', ?) as d,
       count(),
       sum(time),
       sum(case when type = 1 then 1 else 0 end),
       sum(case when type = 1 and ease > 1 then 1 else 0 end)
from revlog where {REAL_REVIEW}
group by d
"""

# A card counts as "new" on the day of its first ever review.
NEW_SQL = f"""
select date(first / 1000, 'unixepoch', 'localtime', ?) as d, count()
from (select min(id) as first from revlog where {REAL_REVIEW} group by cid)
group by d
"""

HOUR_SQL = f"""
select cast(strftime('%H', id / 1000, 'unixepoch', 'localtime') as integer), count()
from revlog where {REAL_REVIEW} and id > ?
group by 1
"""

CARDS_SQL = """
select sum(case when type = 0 then 1 else 0 end),
       sum(case when type in (1, 3) then 1 else 0 end),
       sum(case when type = 2 and ivl < 21 then 1 else 0 end),
       sum(case when type = 2 and ivl >= 21 then 1 else 0 end),
       count()
from cards where queue != -1
"""


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "player"


def build_payload(query, rollover, name):
    """Collect stats. `query(sql, *args)` must return a list of row tuples."""
    offset = f"-{int(rollover)} hours"

    days = {}
    for day, reviews, ms, review_cards, correct in query(DAY_SQL, offset):
        days[day] = {
            "r": reviews,
            "t": round((ms or 0) / 1000),
            "n": 0,
            "rv": review_cards or 0,
            "ok": correct or 0,
        }
    for day, new in query(NEW_SQL, offset):
        days.setdefault(day, {"r": 0, "t": 0, "n": 0, "rv": 0, "ok": 0})["n"] = new

    hours = [0] * 24
    since = int((time.time() - 90 * 86400) * 1000)
    for hour, count in query(HOUR_SQL, since):
        hours[int(hour)] = count

    new, learning, young, mature, total = (v or 0 for v in query(CARDS_SQL)[0])

    return {
        "schema": SCHEMA,
        "name": name.strip(),
        "slug": slugify(name),
        "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "rollover": int(rollover),
        "days": dict(sorted(days.items())),
        "hours": hours,
        "collection": {
            "new": new,
            "learning": learning,
            "young": young,
            "mature": mature,
            "total": total,
        },
    }


def digest(payload):
    """Fingerprint of the stats, ignoring the timestamp."""
    stable = {k: v for k, v in payload.items() if k != "updated"}
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


def upload(cfg, payload):
    import requests  # bundled with Anki

    repo = cfg["repo"].strip().strip("/")
    branch = (cfg.get("branch") or "main").strip()
    url = f"https://api.github.com/repos/{repo}/contents/data/{payload['slug']}.json"
    headers = {
        "Authorization": f"Bearer {cfg['token'].strip()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "anki-buddy-board",
    }
    content = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()

    # Retry once if someone else committed between our read and write.
    for attempt in range(2):
        r = requests.get(url, headers=headers, params={"ref": branch}, timeout=15)
        if r.status_code not in (200, 404):
            raise RuntimeError(describe_error(r))
        body = {
            "message": f"Update Anki stats for {payload['name']}",
            "content": content,
            "branch": branch,
        }
        if r.status_code == 200:
            body["sha"] = r.json()["sha"]
        r = requests.put(url, headers=headers, json=body, timeout=20)
        if r.status_code in (200, 201):
            return
        if r.status_code not in (409, 422) or attempt:
            raise RuntimeError(describe_error(r))


def describe_error(r):
    if r.status_code == 401:
        return "GitHub rejected the token (expired or mistyped?)."
    if r.status_code in (403, 404):
        return ("GitHub says the repo doesn't exist or the token can't write to it. "
                "Check 'repo' and that the token has Contents: read and write.")
    return f"GitHub returned {r.status_code}: {r.text[:200]}"


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f)


# --- Anki integration -------------------------------------------------------

_busy = False


def get_config():
    return mw.addonManager.getConfig(__name__) or {}


def is_configured(cfg):
    return all((cfg.get(k) or "").strip() for k in ("name", "repo", "token")) and "/" in cfg["repo"]


def upload_stats(manual=False, blocking=False):
    global _busy
    cfg = get_config()
    if not is_configured(cfg):
        if manual:
            showWarning("Buddy Board isn't set up yet.\n\nGo to Tools > Add-ons, select "
                        "Anki Buddy Board, click Config, and fill in name, repo and token.")
        return
    if _busy or not mw.col:
        return

    payload = build_payload(mw.col.db.all, mw.col.get_config("rollover", 4), cfg["name"])
    fingerprint = digest(payload)
    if not manual and load_state().get("digest") == fingerprint:
        return

    def task():
        upload(cfg, payload)
        save_state({"digest": fingerprint, "at": payload["updated"]})

    if blocking:  # profile is closing; there's no event loop left to report back to
        try:
            task()
        except Exception:
            pass
        return

    def done(future):
        global _busy
        _busy = False
        try:
            future.result()
        except Exception as e:
            (showWarning if manual else tooltip)(f"Buddy Board upload failed: {e}")
            return
        if manual:
            tooltip("Stats uploaded to the Buddy Board")

    _busy = True
    mw.taskman.run_in_background(task, done)


if mw is not None:
    action = QAction("Upload stats to Buddy Board", mw)
    action.triggered.connect(lambda: upload_stats(manual=True))
    mw.form.menuTools.addAction(action)

    gui_hooks.sync_did_finish.append(lambda: upload_stats())
    gui_hooks.reviewer_will_end.append(lambda: upload_stats())
    gui_hooks.profile_will_close.append(lambda: upload_stats(blocking=True))
