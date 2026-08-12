# syntax=docker/dockerfile:1
# Thulir LIMS Web — React 19 + Vite, served by nginx
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @thulir/web

COPY apps/web ./apps/web
RUN cd apps/web && npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
