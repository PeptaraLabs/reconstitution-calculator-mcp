FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV TRANSPORT=http HOST=0.0.0.0 PORT=8081
EXPOSE 8081
CMD ["node", "src/index.js", "--http"]
