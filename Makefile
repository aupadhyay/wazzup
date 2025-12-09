.PHONY: build clean run test release install browser watch-openapi watch-openapi-fswatch

# Default configuration
CONFIG ?= debug
ARGS ?=

# Paths
BINARY_PATH = $(BUILD_PATH)/$(CONFIG)/Thoughts
APP_NAME = Thoughts.app
APP_PATH = /Applications/$(APP_NAME)
CONTENTS_PATH = $(APP_PATH)/Contents
RESOURCES_PATH = $(CONTENTS_PATH)/Resources

TAURI_DIR = apps/desktop/src-tauri

build:
	cd $(TAURI_DIR) && pnpm run tauri build

run:
	cd $(TAURI_DIR) && pnpm run tauri dev

build-rpc:
	cd packages/rpc && pnpm build

.DEFAULT_GOAL := build 