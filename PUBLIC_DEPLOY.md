# 会议室命名投票 — 对外公开部署指引

## 当前已可用的公开链接

| 用途 | 链接 | 状态 |
| --- | --- | --- |
| **Public Result Page 公示结果页** | https://481b73c41a004331a6e510fd4a381a90.app.workbuddy.link | ✅ 已部署，同事可直接打开看榜单 |

> 公示页是**纯静态快照**，数据来自部署时的 `/api/results`。如需更新榜单数，重新运行本地服务后在项目根执行一次快照刷新并重新部署（见下方"刷新公示页数据"）。

## 关于"三个链接都能公开直接投票"的关键事实

本项目是 **Node.js 全栈应用**（后端 `node:sqlite` + `/api/*` 接口），不是纯静态站点：

- **投票页 `/`** 和 **管理员页 `/admin`** 依赖后端，**必须跑在有 Node 运行时的全栈环境**（Render / 你的服务器 / VPS）。
- **CloudStudio 只托管静态文件，跑不了后端**，所以投票页、管理员页无法用 CloudStudio 公开。
- 因此"三个对外链接"真实形态是：**同一个全栈站点的三个路径**（同一域名）。

## 全栈公开部署（让同事能真正投票）— Render 一键部署

项目已内置 `render.yaml`，三步即可：

### 第 1 步：把代码推到 GitHub（在你本机 Git Bash 执行）
```bash
cd /d/youxi/网站开发/meeting-room-voting
git push origin main
# 若提示凭证，用 GitHub 账号 + Personal Access Token（密码处填 token）
```

### 第 2 步：在 Render 创建服务
1. 打开 https://dashboard.render.com → New → **Blueprint**
2. 连接 GitHub 仓库 `a790425203-ctrl/Meeting-room-name-voting`
3. Render 会自动读取 `render.yaml`，无需手填构建命令（零依赖，`buildCommand: node -v`，`startCommand: node server/index.js`）。
4. 在 Environment 里设置两个变量（务必改掉默认值）：
   - `ADMIN_PASSWORD` = 你的强密码（否则任何人都可用默认 admin123 进后台）
   - `SESSION_SECRET` = 一段随机长字符串（用于令牌签名）
5. 免费版选 region `singapore`（离国内近）。
6. Create → 等待部署完成（约 1–2 分钟）。

### 第 3 步：拿到三个对外链接（同一域名）
部署完成后 Render 会给你一个形如 `https://meeting-room-name-voting.onrender.com` 的地址，三个路径即：

- **Voting Page 投票页面**：https://meeting-room-name-voting.onrender.com/
- **Admin Page 管理员页面**：https://meeting-room-name-voting.onrender.com/admin
- **Public Result Page 公示结果页**：https://meeting-room-name-voting.onrender.com/results

把这三个发给同事即可（投票 + 看榜一体）。

> 注：Render 免费版**休眠**——15 分钟无访问会停，下次访问冷启动约 30–50 秒，首次打开稍慢属正常。
> 持久化：`data/` 已按 `render.yaml` 挂持久磁盘，重启不丢投票数据。

## 刷新公示页静态快照数据（仅当用 CloudStudio 静态公示页时）

项目根执行（需本地服务在 3000 端口运行）：
```bash
cd /d/youxi/网站开发/meeting-room-voting
node -e 'const http=require("http");function g(p){return new Promise((r,j)=>{http.get("http://localhost:3000"+p,x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>r(JSON.parse(d)));}).on("error",j);});}(async()=>{const data=await g("/api/results");require("fs").writeFileSync("static-results/embed.js","window.MRV_EMBEDDED = "+JSON.stringify(data,null,2)+";\n");console.log("embed.js 已刷新");})();'
```
然后重新部署 static-results 目录到 CloudStudio。

## 本地自测 / 内网使用
```bash
cd /d/youxi/网站开发/meeting-room-voting
PORT=3000 node server/index.js
```
- 投票页 http://localhost:3000/ （仅本机/内网可访问）
- 管理员 http://localhost:3000/admin （密码 admin123，建议改）
- 公示页 http://localhost:3000/results
