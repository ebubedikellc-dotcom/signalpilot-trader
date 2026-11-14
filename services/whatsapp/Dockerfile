FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node *.mjs ./
USER node
ENV HOST=0.0.0.0 PORT=3040 WHATSAPP_DATA_DIR=/data
CMD ["node", "server.mjs"]
