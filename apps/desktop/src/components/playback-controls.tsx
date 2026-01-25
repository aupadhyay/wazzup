import { useMemo } from "react"

interface PlaybackControlsProps {
  isPlaying: boolean
  currentFrame: number
  totalFrames: number
  speed: number
  delays: number[]
  onPlayPause: () => void
  onSeek: (frameIndex: number) => void
  onSpeedChange: (speed: number) => void
  onRestart: () => void
}

export function PlaybackControls({
  isPlaying,
  currentFrame,
  totalFrames,
  speed,
  delays,
  onPlayPause,
  onSeek,
  onSpeedChange,
  onRestart,
}: PlaybackControlsProps) {
  // Calculate elapsed and total time
  const { elapsed, total } = useMemo(() => {
    const elapsedMs = delays.slice(0, currentFrame).reduce((sum, d) => sum + d, 0)
    const totalMs = delays.reduce((sum, d) => sum + d, 0)
    return {
      elapsed: Math.floor(elapsedMs / 1000),
      total: Math.floor(totalMs / 1000),
    }
  }, [delays, currentFrame])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const speedOptions = [0.5, 1, 2, 4]

  return (
    <div className="flex flex-col gap-4">
      {/* Timeline scrubber */}
      <div className="flex items-center gap-4">
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatTime(elapsed)}
        </span>
        <input
          type="range"
          min="0"
          max={totalFrames - 1}
          value={currentFrame}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-green-500
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4
                     [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-green-500
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:cursor-pointer"
        />
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatTime(total)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Left: Play/Pause and Restart */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRestart}
            className="p-2 rounded hover:bg-zinc-800 transition-colors"
            title="Restart (0)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onPlayPause}
            className="p-3 rounded-full bg-green-600 hover:bg-green-700 transition-colors"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Center: Frame counter */}
        <div className="text-sm text-zinc-400 tabular-nums">
          Frame {currentFrame + 1} / {totalFrames}
        </div>

        {/* Right: Speed selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 mr-2">Speed:</span>
          {speedOptions.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                speed === s
                  ? 'bg-green-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
              title={`${s}x speed (${speedOptions.indexOf(s) + 1})`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-zinc-500 text-center">
        Space: Play/Pause | Arrows: Frame | 1-4: Speed | 0: Restart
      </div>
    </div>
  )
}
