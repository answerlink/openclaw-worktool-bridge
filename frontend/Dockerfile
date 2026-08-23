FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_ANALYTICS_ENABLED=false
ARG VITE_ANALYTICS_URL=https://analytics.ymdyes.cn
ARG VITE_ANALYTICS_WEBSITE_ID=
ENV VITE_ANALYTICS_ENABLED=$VITE_ANALYTICS_ENABLED
ENV VITE_ANALYTICS_URL=$VITE_ANALYTICS_URL
ENV VITE_ANALYTICS_WEBSITE_ID=$VITE_ANALYTICS_WEBSITE_ID
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
