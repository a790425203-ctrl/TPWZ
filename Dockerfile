# 会议室命名投票网站 —— 生产镜像
# 零外部依赖，仅需 Node 22.5+（内置 node:sqlite）
FROM node:22-slim

WORKDIR /app

# 仅复制运行所需文件
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# SQLite 数据目录（部署时挂载持久卷）
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server/index.js"]
