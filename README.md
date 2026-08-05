# MISS·AV 私人观影

无广告、纯静态的个人视频浏览站,部署于 GitHub Pages。

## 特性

- 🎬 视频推荐流(推荐 / FC2 / 无码流出 / 中文字幕 / 新作速递)
- 🔍 本地搜索(番号 / 标题 / 演员 / 系列 / 类型,实时过滤)
- 📋 详情弹窗(元数据 + 相关推荐,点击前往原站播放)
- 🌙 深色流媒体风格,响应式,移动端友好
- 🚫 无任何广告

## 架构

```
GitHub Actions(每 6 小时)
    │  scripts/fetch_data.py 调用 MissAV Recombee 推荐 API
    ▼
data/videos.json + data/feeds.json   ← 提交到仓库
    │
    ▼
GitHub Pages 静态托管 → 前端(index.html)直接读取
```

- 数据源:MissAV 的 Recombee 推荐系统 API(公开只读 token,免登录)
- 封面/预览图:fourhoi.com(需 `referrerpolicy="no-referrer"` 绕过防盗链)
- 播放:点击卡片 → 新标签打开 missav.ws 原站播放页

## 部署

1. 推送到 GitHub 仓库
2. 仓库 Settings → Pages → 选择 `main` 分支根目录
3. 手动触发一次 `Fetch MissAV Data` workflow(或等定时任务)刷新数据

## 手动刷新数据

```bash
pip install requests
python3 scripts/fetch_data.py   # 本地跑一次,提交 data/ 变更
```
