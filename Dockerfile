# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

# Want to help us make this template better? Share your feedback here: https://forms.gle/ybq9Krt8jtBL3iCk7

ARG NODE_VERSION=24.11.0
ARG PNPM_VERSION=10.20.0

################################################################################
# Use node image for base image for all stages.
FROM node:${NODE_VERSION}-slim AS base

# Install system dependencies (e.g. `antiword` required for text extraction of .doc by `textract`)
RUN apt-get update && apt-get install -y antiword --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install pnpm.
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm@${PNPM_VERSION}

WORKDIR /usr/src/nlp-ninja

################################################################################
# install-dependencies
FROM base AS install-dependencies

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.local/share/pnpm/store to speed up subsequent builds.
# Leverage a bind mounts to package.json and pnpm-lock.yaml to avoid having to copy them into
# into this layer.
RUN \
    # mount monorepo: root files
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    # NOTE: the {-workspace.yaml} is required to install {node_modules} in each sub-module
    --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
    # mount monorepo: web-apps and packages files
    --mount=type=bind,source=apps/be-krang/package.json,target=apps/be-krang/package.json \
    --mount=type=bind,source=apps/ui-sauce/package.json,target=apps/ui-sauce/package.json \
    --mount=type=bind,source=apps/electron/package.json,target=apps/electron/package.json \
    --mount=type=bind,source=packages/toolkit/package.json,target=packages/toolkit/package.json \
    # mount cache and install dependencies
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    (\
        # Install dependencies with pnpm
        # pnpm install --prod --frozen-lockfile
        pnpm install --frozen-lockfile \
    )

################################################################################
# pre-build--source-code stage
# This stage is used to build the source code of all web applications.
FROM install-dependencies as pre-build--source-code

# Copy the rest of the source files into the image.
COPY . .

# Build the source code of all applications.
# RUN pnpm run build:packages
RUN pnpm run build:apps

################################################################################
# production stage
FROM install-dependencies AS production

# Set node environment.
ENV NODE_ENV production

# Copy the built source code from the pre-build stage.
# COPY --chown=node:node --from=pre-build--source-code /usr/src/nlp-ninja/packages/toolkit/dist ./packages/toolkit/dist
COPY --chown=node:node --from=pre-build--source-code /usr/src/nlp-ninja/apps/ui-sauce/dist ./apps/ui-sauce/dist

# Run the application as a non-root user.
USER node

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application.
CMD ["pnpm", "run", "serve:apps"]

################################################################################
# development stage
FROM install-dependencies AS development

# Set node environment.
ENV NODE_ENV development

# Copy the built source code from the pre-build stage.
# COPY --chown=node:node --from=pre-build--source-code /usr/src/nlp-ninja/packages/toolkit/dist ./packages/toolkit/dist
COPY --chown=node:node --from=pre-build--source-code /usr/src/nlp-ninja/apps/ui-sauce/dist ./apps/ui-sauce/dist

# Run the application as a non-root user.
USER node

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application.
CMD ["pnpm", "run", "dev:apps"]
