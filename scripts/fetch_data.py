#!/usr/bin/env python3
"""MissAV 数据抓取脚本(供 GitHub Actions 定时执行)

从 Recombee API 抓取推荐/分类/搜索数据,合并到 data/videos.json 与 data/feeds.json。
- videos.json: 全量去重合并的视频数据集(随运行次数积累)
- feeds.json: 各 feed 的视频 id 列表(首页推荐 / 分类页)

用法: python3 scripts/fetch_data.py
"""
import hmac, hashlib, time, json, os, uuid, random
from urllib.parse import quote
from urllib.request import Request, urlopen

DATABASE_ID = "missav-default"
PUBLIC_TOKEN = "Ikkg568nlM51RHvldlPvc2GzZPE9R4XGzaH9Qj4zK9npbbbTly1gj9K4mgRn0QlV"
BASE = "https://client-rapi-missav.recombee.com"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
VIDEOS_PATH = os.path.join(DATA_DIR, "videos.json")
FEEDS_PATH = os.path.join(DATA_DIR, "feeds.json")


def sign(path: str) -> str:
    ts = int(time.time())
    unsigned = f"/{DATABASE_ID}{path}"
    unsigned += f"&frontend_timestamp={ts}" if "?" in unsigned else f"?frontend_timestamp={ts}"
    sig = hmac.new(PUBLIC_TOKEN.encode(), unsigned.encode(), hashlib.sha1).hexdigest()
    return unsigned + f"&frontend_sign={sig}"


def call(path: str, body: dict) -> dict:
    url = f"{BASE}{sign(path)}"
    req = Request(url, data=json.dumps(body).encode(),
                  headers={"Accept": "application/json", "Content-Type": "application/json",
                           "Origin": "https://missav.ws", "Referer": "https://missav.ws/"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def new_uid() -> str:
    return "anon_" + uuid.uuid4().hex[:16]


def fetch_items(path_fmt: str, scenarios: list, count: int = 30, pages: int = 1, query: str = None) -> list:
    """抓取一个 feed 的 items,支持分页续推。返回 [{id, values}]"""
    out = []
    uid = new_uid()
    recomm_id = None
    for _ in range(pages):
        body = {"count": count, "cascadeCreate": True, "returnProperties": True}
        if query is not None:
            body["searchQuery"] = query
        if recomm_id:
            path = f"/recomms/next/items/{quote(recomm_id, safe='')}"
            body = {"count": count}
        else:
            path = path_fmt(uid)
            if scenarios:
                body["scenario"] = random.choice(scenarios) if isinstance(scenarios, list) else scenarios
        try:
            data = call(path, body)
        except Exception as e:
            print(f"  ! fetch error: {e}")
            break
        recomm_id = data.get("recommId")
        items = data.get("recomms", [])
        out.extend(items)
        if recomm_id is None or len(items) < count * 0.5:
            break
    return out


def item_to_dict(it: dict) -> dict:
    """Recombee item -> 精简字段(减小 JSON 体积)"""
    v = it.get("values", {})
    return {
        "id": it["id"],
        "title": v.get("title", ""),
        "title_cn": v.get("title_cn") or v.get("title_zh", ""),
        "actresses": v.get("actresses", []),
        "actors": v.get("actors", []),
        "genres": v.get("genres", []),
        "markers": v.get("markers", []),
        "labels": v.get("labels", []),
        "series": v.get("series", []),
        "tags": v.get("tags", []),
        "duration": v.get("duration", 0),
        "released_at": int(v.get("released_at", 0)),
        "dm": v.get("dm", 0),
        "has_cn": v.get("has_chinese_subtitle", False),
        "has_en": v.get("has_english_subtitle", False),
        "uncensored": v.get("is_uncensored_leak", False),
    }


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    # 加载已有数据集(积累模式)
    videos = {}
    if os.path.exists(VIDEOS_PATH):
        with open(VIDEOS_PATH, encoding="utf-8") as f:
            for v in json.load(f):
                videos[v["id"]] = v

    feeds = {}

    # 1. 首页个性化推荐(不同 scenario 各取 2 页)
    print("== 抓取首页推荐 ==")
    home = []
    for sc in ["desktop-home-recommended", "mobile-home-recommended"]:
        home.extend(fetch_items(lambda uid: f"/recomms/users/{uid}/items/", [sc], count=30, pages=2))
    feeds["home"] = [it["id"] for it in home]
    for it in home:
        videos.setdefault(it["id"], item_to_dict(it))

    # 2. 分类 feed:用热门视频的相似推荐拼出分类流(覆盖 fc2 / 无码 / 中字等)
    print("== 抓取分类相关 ==")
    seeds = ["fc2-ppv-4929169", "abf-096", "miaa-717", "start-573", "ssis-880", "midv-551"]
    cat_seeds = {
        "fc2":        ["fc2-ppv-4929169", "fc2-ppv-4834495"],
        "uncensored": ["abf-096", "adn-757-chinese-subtitle"],
        "subtitle":   ["achj-082-chinese-subtitle", "abf-120-chinese-subtitle"],
        "new":        ["55t3800056", "080725_100"],
    }
    for cat, sds in cat_seeds.items():
        ids = []
        for sd in sds[:2]:
            try:
                items = fetch_items(lambda uid, sd=sd: f"/recomms/items/{quote(sd, safe='')}/items/",
                                    ["desktop-watch-next-side"], count=30, pages=1)
            except Exception as e:
                print(f"  ! {cat} error: {e}")
                items = []
            ids.extend(it["id"] for it in items)
            for it in items:
                videos.setdefault(it["id"], item_to_dict(it))
        # 去重保序
        seen, dedup = set(), []
        for i in ids:
            if i not in seen:
                seen.add(i); dedup.append(i)
        feeds[cat] = dedup
        print(f"  {cat}: {len(dedup)} 条")

    # 3. 搜索热点词(积累更多视频)
    print("== 抓取搜索热词 ==")
    hot_keywords = ["FC2", "無碼", "中文字幕", "素人", "巨乳", "美尻", "緊縛", "S級", "單體", "4K"]
    for kw in hot_keywords:
        try:
            items = fetch_items(lambda uid: f"/search/users/{quote(uid, safe='')}/items/",
                                [], count=30, pages=1, query=kw)
        except Exception as e:
            print(f"  ! {kw} error: {e}")
            continue
        for it in items:
            videos.setdefault(it["id"], item_to_dict(it))
    print(f"  搜索热词完成,当前视频总量: {len(videos)}")

    # 4. 写入
    with open(VIDEOS_PATH, "w", encoding="utf-8") as f:
        json.dump(list(videos.values()), f, ensure_ascii=False)
    with open(FEEDS_PATH, "w", encoding="utf-8") as f:
        json.dump(feeds, f, ensure_ascii=False)
    print(f"✅ 完成: {len(videos)} 部视频, {list(feeds.keys())}")


if __name__ == "__main__":
    main()
