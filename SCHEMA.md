# 数据表 · 字段 · 交互逻辑（v2）

> 网站面向用户的文案全部为英文；本说明文档使用中文便于团队维护。

## 1. 核心业务规则（v2 更新）

**每个主题独立计票**，两套数据完全隔离。

**组合上限（组合 cap）**：单个用户在一个主题内，"勾选的预设候选"与"有效个人提名"的数量之和，不得超过 `voting_activity.total_meeting_rooms`（即会议室总数 N，同时也是本主题的票数上限）。N 由管理员配置，默认 7。

**为什么改成组合上限**：会议室数量是真实存在的资源（7 间），用户的"贡献"（选名 + 提名）应当与之一一对应，而不是用两个相互独立的硬上限（旧的"最多 5 个预设 + 最多 2 个提名"）。

* 配置 `total_meeting_rooms = 7`：每主题最多 7 条贡献（4 选 + 3 提、5 选 + 2 提、7 选 + 0 提等均合法）。
* 配置 `total_meeting_rooms = 10`：每主题最多 10 条贡献。
* 超出部分**服务端静默截断**（保留前 N 个有效输入），前端实时阻止并给出"已到达 N 票上限"提示。

## 2. 三张核心表 + 一张支撑表

数据库使用 SQLite（Node 内置 `node:sqlite`），持久化文件 `data/voting.db`，表结构如下。

### 2.1 `voting_activity` — 活动配置表（单行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增主键 |
| `site_title` | TEXT NOT NULL | 站点标题 |
| `total_meeting_rooms` | INTEGER NOT NULL | 会议室总数 = 每主题组合上限（核心） |
| `max_preset_per_theme` | INTEGER NOT NULL | **遗留字段**（不再作为硬限制；保留以兼容历史数据） |
| `max_nominations_per_theme` | INTEGER NOT NULL | **遗留字段**（同上） |
| `max_nomination_inputs` | INTEGER NOT NULL | 提名输入框数量（默认 5，仅 UI 占位） |
| `galaxy_presets` | TEXT NOT NULL (JSON) | 星系主题预设候选列表 |
| `landscape_presets` | TEXT NOT NULL (JSON) | 自然景观主题预设候选列表 |
| `voting_start_at` | TEXT NOT NULL (ISO) | 投票开始时间 |
| `voting_end_at` | TEXT NOT NULL (ISO) | 投票结束时间 |
| `updated_at` | TEXT NOT NULL (ISO) | 配置更新时间 |

`status`（活动状态）由 `voting_start_at` / `voting_end_at` 与当前时间实时推导：`NotStarted` → `VotingOpen` → `VotingClosed`，不存表。

### 2.2 `app_user` — 实名用户表（支撑）

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | TEXT PK | UUID（HMAC token 关联键） |
| `fullname` | TEXT NOT NULL UNIQUE | 真实姓名（大小写不敏感唯一） |

用于"读取登录用户姓名"的实名制；投票记录会冗余存储 `user_fullname` 以便历史展示。

### 2.3 `user_theme_vote` — 用户-主题投票记录表

> **一个用户一个主题仅一条记录**，编辑即覆盖，仅保留最新。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 |
| `user_id` | TEXT NOT NULL | FK → app_user |
| `user_fullname` | TEXT NOT NULL | 冗余，便于公示页直接展示 |
| `theme_type` | TEXT NOT NULL | `'Galaxy'` \| `'NaturalLandscape'` |
| `selected_preset_names` | TEXT NOT NULL (JSON) | 勾选的预设候选（数组） |
| `user_nominated_names` | TEXT NOT NULL (JSON) | 有效个人提名（数组，已过滤+去重） |
| `last_modified_time` | TEXT NOT NULL (ISO) | 最近修改时间 |

约束：`UNIQUE(user_id, theme_type)` —— 编辑时 `INSERT … ON CONFLICT DO UPDATE` 覆盖。

**规范化规则（写入前）**：
* 预设：trim、忽略非预设项、大小写去重、限 `total_meeting_rooms` 条。
* 提名：trim、空字符串丢弃、大小写去重、取前 `total_meeting_rooms - selected.length` 条。
* `selected.length + nominated.length ≤ total_meeting_rooms`。

### 2.4 `aggregated_name_result` — 自动聚合榜单表（每主题独立）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 |
| `theme_type` | TEXT NOT NULL | `'Galaxy'` \| `'NaturalLandscape'` |
| `name` | TEXT NOT NULL | 名称 |
| `source` | TEXT NOT NULL | `'System Preset'` \| `'User Nominated'` |
| `total_votes` | INTEGER NOT NULL | 票数 |
| `voters` | TEXT NOT NULL (JSON) | 全部投票人姓名（去重排序） |
| `nominators` | TEXT NOT NULL (JSON) | 全部提名者姓名（去重排序） |

约束：`UNIQUE(theme_type, name)`。每次投票变更后，由 `aggregateTheme()` 整体重建该主题的所有条目。

**聚合规则**：每个主题独立计算，名字池 = 系统预设 + 该主题所有用户提名合并。同主题多人提名同一名称 → 合并为一条，票数累加，voters/nominators 为并集。不同主题的同名条目完全独立。

关于 `voters` / `nominators` 的语义：预设名称的 voters = 勾选该预设的用户，nominators 为空；用户提名名称的 voters = nominators = 提名它的用户（提名即投出的一票）。两列表均会被填充记录。

## 3. 投票页（`/`）交互逻辑

1. 顶部 hero 大图 + 品牌渐变（参考 AIIB 官网视觉语言：深海军蓝 + 青绿 + 暖金）。
2. 实名登录（`POST /api/auth/login`），本地保存 `mrv_token`。
3. 加载活动配置 → 取得 `total_meeting_rooms = N`。
4. 渲染两个独立卡片（星系 / 自然景观），每张卡片含：
   * **组合上限指示器**：进度条 + `X / N used` + 实时提示文字。
   * **预设候选复选**（来自管理员配置，10 个）：勾选即占 1 票。
   * **个人提名输入框**（`max_nomination_inputs = 5` 个）：非空、去重后，前 `N - 已选` 个有效。
   * **Save / Update … Vote** 按钮：随时可改、可多次提交（覆盖旧记录）。
5. **客户端实时阻止**：
   * 达到上限 N 时，未选的预设复选自动 disabled。
   * 提示变为红色"You have reached the N-name cap for this theme"。
   * 服务端兜底再次校验并截断。
6. 活动状态非 `VotingOpen` 时，全部控件 disabled，顶部出现对应 banner。
7. 提交成功 → badge 变 `Submitted (Editable)`，toast 提示。

## 4. 公开公示页（`/results`）交互逻辑

> 无需登录。

* 每个主题独立板块，含"Ranking" + **Voting Ledger**（实名投票记录，原"提交日志"改名 —— 更优雅、与 AIIB 语境契合）。
* **Ranking**：按 `total_votes` 降序，每条展示名称、来源标签、总票数、完整投票人 / 提名者名单。前三名 idx 徽章使用金 / 银 / 铜配色。
* **Voting Ledger**：每条记录含投票人姓名（带头像首字母圆）、勾选了哪些预设、个人提名了哪些（无提名显示 *None*）、提交时间（本地化）。按提交时间升序。
* 活动关闭后顶部黄色提示："administrator will select N names from the combined name pool of both themes"。
* 数据每主题独立，跨主题条目互不干扰。

## 5. 管理页（`/admin`）交互逻辑

* 密码登录（默认 `admin123`，环境变量 `ADMIN_PASSWORD` 覆盖）。
* 配置项：**站点标题**、**Total meeting rooms（per-theme cap，核心）**、**Nomination input slots**、**Voting opens/closes at**、两套**Curated names**（每行一个）。
* 旧的 `max_preset_per_theme` / `max_nominations_per_theme` 字段仍在数据库中保留以兼容历史数据，**不再由前端表单编辑**，也不再作为硬限制使用。
* 保存即生效，并自动重算两个主题的聚合榜单。

## 6. API 契约

```
POST /api/auth/login        { fullname }                       → { token, user }
POST /api/auth/admin-login  { password }                        → { token, admin }
GET  /api/auth/me           (auth)                              → { user }
GET  /api/auth/admin-check  (admin)                             → { admin: true }
GET  /api/activity                                              → 活动配置（含派生 status）
PUT  /api/activity          (admin) { site_title, total_meeting_rooms, ... }
GET  /api/votes/mine        (auth)                              → { galaxy, landscape }
PUT  /api/votes/:theme      (auth) { selected_preset_names, nominated_inputs }
   :theme ∈ { galaxy, landscape }                                → { vote, cap: { combined_limit, used, remaining, ... } }
GET  /api/results           (public)                            → 两主题独立 ranking + submissions
```

`PUT /api/votes/:theme` 响应新增 `cap` 字段，前端据此展示实时提示。