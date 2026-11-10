FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

# Cài đặt thêm postgresql-client để sử dụng lệnh pg_dump và psql cho Backup/Restore
RUN apk add --no-cache postgresql-client

COPY . .

# Tạo sẵn thư mục lưu ảnh và thư mục tmp để xử lý file backup
RUN mkdir -p /app/public/uploads /app/tmp

EXPOSE 3000

CMD ["node", "server.js"]