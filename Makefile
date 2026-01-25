.PHONY: build dev build-rpc

TAURI_DIR = apps/desktop/src-tauri

build:
	pnpm build:rpc
	cd $(TAURI_DIR) && pnpm run tauri build --bundles app

dev:
	cd $(TAURI_DIR) && pnpm run tauri dev

build-rpc:
	pnpm build:rpc

.DEFAULT_GOAL := build
