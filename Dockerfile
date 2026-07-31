# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

# Want to help us make this template better? Share your feedback here: https://forms.gle/ybq9Krt8jtBL3iCk7

ARG NODE_VERSION=24.18.0
ARG PNPM_VERSION=11.15.1

################################################################################
# Use node image for base image for all stages.
FROM node:${NODE_VERSION}-slim AS base

# 1. Install python3-openpyxl for working with .xlsx files. This is needed at
#    RUNTIME (both dev and prod) since apps/be-krang's python-executor falls
#    back to `python3 <script>.py` whenever the PyInstaller-compiled binaries
#    aren't present (see src/python-scripts/python-executor.mts). The
#    PyInstaller build toolchain itself (python3-venv, binutils, libpython3.11)
#    lives in the pre-build--python stage below, since it's only needed to
#    produce a production release, not to run dev or prod containers.
RUN apt-get update && apt-get install -y \
    python3-openpyxl \
    && rm -rf /var/lib/apt/lists/*

# 2. Install LibreOffice, Python3, and the UNO bridge required for scripting .xlsb files.
# RUN apt-get update && apt-get install -y \
#     libreoffice \
#     libreoffice-script-provider-python \
#     python3-uno \
#     python3-pip \
#     && rm -rf /var/lib/apt/lists/*

# Install pnpm.
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm@${PNPM_VERSION}

WORKDIR /usr/src/doc-ninja

# WORKDIR creates this directory as root. production/development later switch
# to `USER node` to run the app, but pnpm needs write access to this directory
# itself (e.g. temp state files it creates at the workspace root), so hand
# ownership to the `node` user (built into the base node image) up front.
RUN chown node:node /usr/src/doc-ninja

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
# Builds the JS/TS source of all workspaces (no native toolchain required).
# This is the shared baseline for both the development image and the JS
# artifacts of the production image.
FROM install-dependencies AS pre-build--source-code

# Copy the rest of the source files into the image.
COPY . .

# Build the source code of all applications.
# RUN pnpm run build:packages
RUN pnpm run build:apps

################################################################################
# pre-build--python stage
# Compiles apps/be-krang's Python scripts into standalone binaries via
# PyInstaller. Isolated in its own stage - on top of pre-build--source-code -
# because it's the only part of the build that needs a native toolchain
# (binutils, libpython3.11) and it's only required for a production release,
# never for development.
FROM pre-build--source-code AS pre-build--python

RUN apt-get update && apt-get install -y \
    python3-venv \
    binutils \
    libpython3.11 \
    && rm -rf /var/lib/apt/lists/*

RUN pnpm --filter "./apps/be-krang" run build:python

################################################################################
# production stage
FROM install-dependencies AS production

# Set node environment.
ENV NODE_ENV production

# Copy the built source code from the pre-build stages.
# COPY --chown=node:node --from=pre-build--source-code /usr/src/doc-ninja/packages/toolkit/dist ./packages/toolkit/dist
COPY --chown=node:node --from=pre-build--source-code /usr/src/doc-ninja/apps/ui-sauce/dist ./apps/ui-sauce/dist
COPY --chown=node:node --from=pre-build--python /usr/src/doc-ninja/apps/be-krang/dist ./apps/be-krang/dist

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
# COPY --chown=node:node --from=pre-build--source-code /usr/src/doc-ninja/packages/toolkit/dist ./packages/toolkit/dist
COPY --chown=node:node --from=pre-build--source-code /usr/src/doc-ninja/apps/ui-sauce/dist ./apps/ui-sauce/dist

# Run the application as a non-root user.
USER node

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application.
CMD ["pnpm", "run", "dev:apps"]
