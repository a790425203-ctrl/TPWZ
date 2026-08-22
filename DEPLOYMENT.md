# 部署上线指导

本应用是 **Node.js 全栈应用**（自带 HTTP 服务 + 内置 SQLite），不是纯静态站点。
零外部依赖，部署只需一台能跑 Node 22.5+ 的环境。

---

## 0. 部署前必读（安全）

上线前请务必通过环境变量覆盖以下默认值：

```bash
export SESSION_SECRET="一段足够长的随机字符串"
export ADMIN_PASSWORD="强管理员密码"
```

不修改的话，任何人用默认密码 `admin123` 都能进入后台，令牌签名密钥也是公开的默认值。

---

## 方案 A：本地 / 内网快速运行

```bash
# 进入项目目录
cd meeting-room-voting
# 启动（默认 3000 端口）
node server/index.js
```

访问：
- 投票页：`http://localhost:3000/`
- 公示页：`http://localhost:3000/results`
- 管理页：`http://localhost:3000/admin`

数据自动写入 `data/voting.db`，重启不丢失。

---

## 方案 B：Docker 部署（推荐）

项目已提供 `Dockerfile`。构建并运行：

```bash
# 构建镜像
docker build -t meeting-room-voting .

# 运行（挂载数据卷持久化 SQLite，并传入环境变量）
docker run -d --name voting \
  -p 3000:3000 \
  -v voting_data:/app/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD="你的强密码" \
  meeting-room-voting
```

数据保存在 Docker 卷 `voting_data` 中，容器重建不丢数据。

---

## 方案 C：VPS / 云主机（systemd）

以 Ubuntu 为例：

```bash
# 1. 安装 Node 22（使用 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 放置代码
sudo mkdir -p /opt/meeting-room-voting
sudo cp -r server public package.json /opt/meeting-room-voting/

# 3. 创建服务
sudo tee /etc/systemd/system/meeting-room-voting.service > /dev/null <<'EOF'
[Unit]
Description=Meeting Room Name Voting
After=network.target

[Service]
WorkingDirectory=/opt/meeting-room-voting
Environment=PORT=3000
Environment=SESSION_SECRET=你的随机密钥
Environment=ADMIN_PASSWORD=你的强密码
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
EOF

# 4. 启动并开机自启
sudo systemctl daemon-reload
sudo systemctl enable --now meeting-room-voting
```

（也可用 PM2：`pm2 start server/index.js --name voting`）

---

## 方案 D：云 PaaS（Railway / Render / Fly.io 等）

这些平台「从 Git 仓库部署」即可，无需手写运维：

1. 把项目推送到 GitHub。
2. 在平台新建服务并连接该仓库。
3. 关键配置：
   - **Build/启动命令**：`node server/index.js`（无构建步骤）。
   - **Node 版本**：选择 `22`。
   - **端口**：`3000`（或按平台要求读取 `PORT` 环境变量，本应用已兼容）。
   - **环境变量**：`SESSION_SECRET`、`ADMIN_PASSWORD`。
   - **持久化磁盘**：把 `data/` 目录挂到持久卷（否则重启会丢投票数据）。
     - Railway：挂载 Volume 到 `/app/data`。
     - Render：挂载 Disk 到 `/app/data`。
     - Fly.io：挂载 Volume 到 `/app/data`。

---

## 方案 E：域名 + HTTPS（反向代理）

将应用放在 Nginx / Caddy 之后，用域名通过 HTTPS 访问。

Nginx 示例：

```nginx
server {
    listen 80;
    server_name vote.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

申请证书（可选其一）：

```bash
# Caddy（自动 HTTPS）
#   Caddyfile:  vote.example.com { reverse_proxy 127.0.0.1:3000 }

# certbot（Nginx）
sudo certbot --nginx -d vote.example.com
```

---

## 生产环境检查清单

- [ ] 已设置强 `ADMIN_PASSWORD`（非默认 `admin123`）
- [ ] 已设置随机 `SESSION_SECRET`
- [ ] `data/` 目录已挂载持久卷 / 定期备份 `data/voting.db`
- [ ] 已启用 HTTPS
- [ ] 投票时间窗（后台可配）已按活动设置
- [ ] 如需接入企业 SSO 实名，替换 `server/auth.js` 中的登录逻辑（当前为「输入姓名」的简化实名）

---

## 常见问题

| 问题 | 原因 / 解决 |
| --- | --- |
| 启动报 `node:sqlite` 不可用 | Node 版本低于 22.5；升级到 Node 22+ |
| 重启后投票数据丢失 | `data/` 未挂持久卷（容器/PaaS 场景） |
| 后台进不去 | 用 `ADMIN_PASSWORD` 环境变量的值登录，非默认 `admin123` |
| 端口被占用 | 修改 `PORT` 环境变量 |
| 跨域报错 | 本应用前后端同源，无需 CORS；若反向代理请保持同域 |
