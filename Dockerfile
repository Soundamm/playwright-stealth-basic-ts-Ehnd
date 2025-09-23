# Use Playwright v1.50.0 with noble (Ubuntu 24.04)
FROM mcr.microsoft.com/playwright:v1.50.0-noble
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms/playwright
ENV NODE_OPTIONS="--max-old-space-size=512"

# Expose port
EXPOSE 3000

# Start the application (comando corregido)
CMD ["node", "dist/server.js"]
