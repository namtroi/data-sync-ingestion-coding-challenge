FROM node:20-alpine AS builder

WORKDIR /app

# Copy package config
COPY package*.json ./

# Install cleanly
RUN npm ci

# Copy source code
COPY . .

# Build TS
RUN npm run build


FROM node:20-alpine AS runtime

WORKDIR /app

# Copy production dependencies definition
COPY package*.json ./

# Install only prod dependencies
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Set user to non-root for security
USER node

# Start application
CMD ["node", "dist/index.js"]
