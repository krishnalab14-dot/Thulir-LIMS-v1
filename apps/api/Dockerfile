# syntax=docker/dockerfile:1
# Thulir LIMS API — NestJS 11 + Prisma
FROM node:22-alpine AS build
WORKDIR /app

# Root + api manifests (workspaces)
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace @thulir/api

COPY apps/api ./apps/api
RUN cd apps/api && npx prisma generate
RUN cd apps/api && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
# Full install (devDeps included) so `prisma migrate deploy` can run at boot.
RUN npm ci --workspace @thulir/api

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
# Prisma CLI needs the generated client inside the runtime node_modules:
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

EXPOSE 3000
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
