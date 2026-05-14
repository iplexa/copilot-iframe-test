FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
# Yandex AI credentials injected at build time via --build-arg
ARG VITE_YANDEX_API_KEY
ARG VITE_YANDEX_FOLDER_ID
ENV VITE_YANDEX_API_KEY=$VITE_YANDEX_API_KEY
ENV VITE_YANDEX_FOLDER_ID=$VITE_YANDEX_FOLDER_ID
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
