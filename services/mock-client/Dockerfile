FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=8787
USER node
CMD ["node", "src/server.js"]
