# Thoughts - Project Documentation

## Overview

A lightweight macOS application for quickly capturing thoughts with automatic context attachment. Think "Raycast but for your thoughts" - a quick-access panel that lets you write down ideas while automatically capturing relevant system context like URLs visited, apps used, Spotify tracks, and location.

## Architecture

### Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Desktop Framework**: Tauri v2 (Rust-based)
- **Backend**: tRPC server (type-safe RPC)
- **Database**: SQLite with Drizzle ORM
- **Build System**: pnpm workspaces (monorepo)

### Project Structure

```
thoughts/
├── apps/
│   └── desktop/              # Main Tauri application
│       ├── src/              # React frontend
│       │   ├── components/
│       │   │   ├── quick-panel.tsx       # Quick capture UI (Alt+Space)
│       │   │   ├── main-window.tsx       # Main app window
│       │   │   └── document-editor.tsx   # Rich text editor
│       │   └── App.tsx       # React Router setup
│       └── src-tauri/        # Rust backend
│           ├── src/
│           │   ├── main.rs   # App initialization, shortcuts, windows
│           │   ├── config.rs # App configuration
│           │   └── context.rs # Context gathering (Spotify, URLs, etc.)
│           └── Cargo.toml
├── packages/
│   ├── rpc/                  # tRPC server (sidecar process)
│   │   ├── index.ts          # Router definitions
│   │   ├── server.ts         # Express server setup
│   │   └── trpc.ts           # tRPC initialization
│   ├── db/                   # Database layer
│   │   ├── schema.ts         # Drizzle schema (thoughts table)
│   │   ├── lib.ts            # DB operations
│   │   └── app.db            # SQLite database file
│   └── actions/              # External integrations (TODO)
└── pnpm-workspace.yaml
```

## Key Features

### 1. Quick Capture Panel
- **Trigger**: `Alt+Space` (or `Shift+Alt+Space` in dev mode)
- **Behavior**: Floating window that appears on demand
- **Auto-hide**: Closes when focus is lost
- **Location**: apps/desktop/src/components/quick-panel.tsx

### 2. Context Attachment
Automatically captures system context when creating thoughts:
- **Active Arc URL**: Current browser URL from Arc browser
- **Spotify Track**: Currently playing track (artist + song)
- **Focused App**: Currently active application (name + bundle ID)
- **Location**: Geographic location with full address details
- **Implementation**: apps/desktop/src-tauri/src/context.rs (via AppleScript)

### 3. Three Window Types

#### Quick Panel (quick-panel)
- Small floating window (400x500)
- Frameless, transparent, always on top
- Quick thought capture with context badges
- Global shortcut access

#### Main Window (main)
- Standard app window (800x600)
- Browse and search all thoughts
- Resizable, maximizable
- Accessible via tray icon or quick panel

### 4. Database Schema

**thoughts** table:
```typescript
{
  id: integer (primary key, auto-increment)
  content: text (required)
  metadata: text (JSON: spotify, URLs, location, etc.)
  timestamp: text (auto-generated)
}
```

### 5. tRPC API

Two main procedures:
- `createThought(content, metadata)`: Save a new thought
- `getThoughts(search?)`: Retrieve thoughts with optional search

The tRPC server runs as a Tauri sidecar process (bundled binary) at http://localhost:3001

## How It Works

### Application Flow

1. **App Launch**:
   - Tauri initializes 3 windows (all initially hidden)
   - Spawns tRPC sidecar server
   - Registers `Alt+Space` global shortcut
   - Creates system tray icon
   - Sets app to "Accessory" mode (no dock icon)

2. **Capturing a Thought**:
   - User presses `Alt+Space`
   - Quick panel shows and focuses
   - User types content, optionally attaches context
   - On submit: tRPC mutation creates DB entry
   - Panel hides automatically

3. **Context Collection**:
   - Rust invokes AppleScript on-demand
   - Returns structured data (JSON)
   - Frontend displays as removable badges
   - Stored as JSON in `metadata` column

### Build Process

**Development**:
```bash
pnpm dev                    # Start Vite dev server + Tauri
pnpm db:studio             # Open Drizzle Studio (DB GUI)
```

**Production**:
```bash
pnpm --filter @thoughts/rpc build  # Build tRPC server binary
pnpm build                         # Build frontend
pnpm tauri build                   # Create macOS app bundle
```

The RPC server is packaged as a binary using `pkg` and included as a Tauri external binary.

## Recent Changes (from git history)

- `a530f1d`: Added search functionality
- `723cd04`: Removed legacy Swift implementation
- `f07a900`: Fixed location context in production
- `2de19e0`: Added location context gathering
- `309f6b6`: Added focused app context + README

## Planned Features (TODO)

From README.md:

1. **Auto-categorization**:
   - Thoughts captured in short time spans are related
   - Use basic embeddings for clustering

2. **Automated Follow-ups**:
   - Starter conversations with related thoughts as context
   - Daily cron jobs running local LLM

3. **Plugins**:
   - Different context depending on launch source
   - App-specific integrations

## Development Notes

### Key Files to Understand

1. **apps/desktop/src-tauri/src/main.rs** (lines 109-120): Global shortcut handler
2. **apps/desktop/src/components/quick-panel.tsx**: Main UI logic
3. **packages/rpc/index.ts**: API definitions
4. **packages/db/schema.ts**: Data model
5. **apps/desktop/src-tauri/src/context.rs**: System context gathering

### Environment

- macOS only (uses AppleScript, CoreLocation)
- Requires location permissions
- Spotify context requires Spotify app running
- Arc browser for URL context

### Commands

```bash
# Database
pnpm db:generate    # Generate migrations
pnpm db:push        # Apply schema changes
pnpm db:studio      # Open DB GUI

# Development
cd apps/desktop && pnpm tauri dev

# Building
pnpm --filter @thoughts/rpc build
cd apps/desktop && pnpm tauri build
```

## Troubleshooting

- **Server won't start**: Check PID file cleanup in config.rs
- **Context not working**: Verify AppleScript permissions in System Settings
- **Location fails**: Grant location access to the app
- **Shortcut conflicts**: Debug mode uses `Shift+Alt+Space` instead

## Dependencies

Key packages:
- `@tauri-apps/*`: Desktop framework
- `@trpc/*`: Type-safe API
- `drizzle-orm`: SQL ORM
- `better-sqlite3`: SQLite driver
- `@tiptap/*`: Rich text editor
- `react-router-dom`: Routing
- `@tanstack/react-query`: Data fetching

## License

ISC
