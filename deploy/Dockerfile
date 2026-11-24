FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY public/ ./public/
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN mkdir -p /app/data && chown -R root:root /app && chmod -R a-w /app/src /app/public /app/scripts /app/package.json /app/package-lock.json && chown -R node:node /app/data
USER node
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3001/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
