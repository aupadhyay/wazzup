import { useEffect, useMemo, useReducer } from "react"
import { useSearchParams } from "react-router-dom"
import { trpc } from "../api"
import { EditorView } from "./editor-view"
import { PlaybackControls } from "./playback-controls"

// Import types and utilities from playback engine
import type {
  EditOperation,
  PlaybackFrame,
} from "../../../../packages/actions/scripts/animation/utils/playbackEngine"
import {
  generateFrames,
  calculateFrameDelays,
} from "../../../../packages/actions/scripts/animation/utils/playbackEngine"

interface PlaybackState {
  isPlaying: boolean
  currentFrameIndex: number
  speed: number
}

type PlaybackAction =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE" }
  | { type: "SEEK"; frameIndex: number }
  | { type: "NEXT_FRAME" }
  | { type: "CHANGE_SPEED"; speed: number }
  | { type: "RESTART" }

function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction
): PlaybackState {
  switch (action.type) {
    case "PLAY":
      return { ...state, isPlaying: true }
    case "PAUSE":
      return { ...state, isPlaying: false }
    case "TOGGLE":
      return { ...state, isPlaying: !state.isPlaying }
    case "SEEK":
      return { ...state, currentFrameIndex: action.frameIndex, isPlaying: false }
    case "NEXT_FRAME":
      return { ...state, currentFrameIndex: state.currentFrameIndex + 1 }
    case "CHANGE_SPEED":
      return { ...state, speed: action.speed }
    case "RESTART":
      return { ...state, currentFrameIndex: 0, isPlaying: false }
    default:
      return state
  }
}

export function ReplayWindow() {
  const [searchParams] = useSearchParams()
  const thoughtId = Number(searchParams.get("thoughtId"))

  const [playbackState, dispatch] = useReducer(playbackReducer, {
    isPlaying: false,
    currentFrameIndex: 0,
    speed: 1,
  })

  // Fetch edit operations
  const { data: operations, isLoading, error } = trpc.getEditOperations.useQuery(
    { thought_id: thoughtId },
    { enabled: !!thoughtId, retry: 2 }
  )

  // Generate frames (memoized)
  const frames = useMemo(() => {
    if (!operations || operations.length === 0) return []
    return generateFrames(operations as EditOperation[])
  }, [operations])

  // Calculate delays based on speed (memoized)
  const delays = useMemo(() => {
    if (frames.length === 0) return []
    return calculateFrameDelays(frames, playbackState.speed)
  }, [frames, playbackState.speed])

  // Playback loop
  useEffect(() => {
    if (!playbackState.isPlaying) return
    if (playbackState.currentFrameIndex >= frames.length - 1) {
      dispatch({ type: "PAUSE" })
      return
    }

    const delay = delays[playbackState.currentFrameIndex] || 0
    const timeoutId = setTimeout(() => {
      dispatch({ type: "NEXT_FRAME" })
    }, delay)

    return () => clearTimeout(timeoutId)
  }, [
    playbackState.isPlaying,
    playbackState.currentFrameIndex,
    delays,
    frames.length,
  ])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return // Don't interfere with inputs

      switch (e.key) {
        case " ":
          e.preventDefault()
          dispatch({ type: "TOGGLE" })
          break
        case "ArrowLeft":
          e.preventDefault()
          if (playbackState.currentFrameIndex > 0) {
            dispatch({
              type: "SEEK",
              frameIndex: playbackState.currentFrameIndex - 1,
            })
          }
          break
        case "ArrowRight":
          e.preventDefault()
          if (playbackState.currentFrameIndex < frames.length - 1) {
            dispatch({
              type: "SEEK",
              frameIndex: playbackState.currentFrameIndex + 1,
            })
          }
          break
        case "0":
          dispatch({ type: "RESTART" })
          break
        case "1":
          dispatch({ type: "CHANGE_SPEED", speed: 0.5 })
          break
        case "2":
          dispatch({ type: "CHANGE_SPEED", speed: 1 })
          break
        case "3":
          dispatch({ type: "CHANGE_SPEED", speed: 2 })
          break
        case "4":
          dispatch({ type: "CHANGE_SPEED", speed: 4 })
          break
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [playbackState.currentFrameIndex, frames.length])

  // Error states
  if (!thoughtId || isNaN(thoughtId)) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Invalid thought ID
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900">
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load edit history</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Loading edit history...
      </div>
    )
  }

  if (!operations || operations.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        No edit history available for this thought
      </div>
    )
  }

  const currentFrame = frames[playbackState.currentFrameIndex]

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-white">
      {/* Title bar drag region */}
      <div className="h-[28px]" data-tauri-drag-region />

      {/* Editor view area */}
      <div className="flex-1 overflow-auto p-8">
        <EditorView
          content={currentFrame?.state.content || ""}
          cursorPosition={currentFrame?.state.cursorPosition || 0}
        />
      </div>

      {/* Controls panel */}
      <div className="border-t border-zinc-800 p-4 bg-zinc-900">
        <PlaybackControls
          isPlaying={playbackState.isPlaying}
          currentFrame={playbackState.currentFrameIndex}
          totalFrames={frames.length}
          speed={playbackState.speed}
          delays={delays}
          onPlayPause={() => dispatch({ type: "TOGGLE" })}
          onSeek={(frameIndex) => dispatch({ type: "SEEK", frameIndex })}
          onSpeedChange={(speed) => dispatch({ type: "CHANGE_SPEED", speed })}
          onRestart={() => dispatch({ type: "RESTART" })}
        />
      </div>
    </div>
  )
}
