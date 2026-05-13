# SimpleOne Copilot iframe test frontend — вариант под host NGINX

Тестовый внешний frontend для iframe-модалки SimpleOne.

Домен: `copilot.plxa.ru`.

Архитектура:

```text
Internet HTTPS → host NGINX :443 → http://127.0.0.1:3010 → Docker container nginx → React static files
```

## Запуск контейнера

```bash
cd /opt/copilot-iframe-test-nginx
docker compose up -d --build
```

Проверка контейнера локально на сервере:

```bash
curl -i http://127.0.0.1:3010/health
```

## Host NGINX server block

Создай файл:

```bash
sudo nano /etc/nginx/sites-available/copilot.plxa.ru
```

Пример конфига:

```nginx
server {
    listen 80;
    server_name copilot.plxa.ru;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name copilot.plxa.ru;

    ssl_certificate /etc/letsencrypt/live/copilot.plxa.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/copilot.plxa.ru/privkey.pem;

    # ВАЖНО: замени на origin твоей песочницы SimpleOne.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://your-simpleone-instance.example.ru; base-uri 'self'; form-action 'self';" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активировать:

```bash
sudo ln -s /etc/nginx/sites-available/copilot.plxa.ru /etc/nginx/sites-enabled/copilot.plxa.ru
sudo nginx -t
sudo systemctl reload nginx
```

## Сертификат Let's Encrypt через certbot

Если сертификата ещё нет:

```bash
sudo certbot --nginx -d copilot.plxa.ru
```

## Проверка

```bash
curl -I https://copilot.plxa.ru/health
```

Тестовый URL:

```text
https://copilot.plxa.ru/simpleone/modal?source=simpleone&table_name=req&record_id=test-sys-id&number=REQ0001&simpleone_origin=https%3A%2F%2Fyour-simpleone-instance.example.ru
```
