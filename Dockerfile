# Use Node.js LTS image
FROM node:20-slim

# Install Chromium and its minimal system dependencies for Puppeteer.
# --no-install-recommends: Keeps the image small by skipping optional packages.
# rm -rf /var/lib/apt/lists/*: Cleans up temporary installer files to reduce image size.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-freefont-ttf \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Prevent Puppeteer from downloading its own version of Chromium.
# We skip this to keep the Docker image small, since we manually install the system-level Chromium browser instead.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Set the path for the Node.js app to find the browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the app
COPY . .

# Expose the port
ENV PORT 8080
EXPOSE 8080

# Start the app
CMD ["npm", "start"]
