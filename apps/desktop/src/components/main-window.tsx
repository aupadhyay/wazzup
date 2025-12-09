import { trpc } from "../api"
import { useEffect, useState, useMemo } from "react"
import { format } from "date-fns"
import "./scrollbar.css"
import type { ContextInfo, Image } from "./quick-panel"

function parseImagesFromMetadata(metadata?: string | null): Image[] {
  if (!metadata) return []
  try {
    const parsed = JSON.parse(metadata) as ContextInfo
    return Array.isArray(parsed?.images) ? (parsed?.images as Image[]) : []
  } catch {
    return []
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

function highlightMatches(text: string, searchQuery: string): React.ReactNode {
  if (!searchQuery.trim()) return text

  const regex = new RegExp(
    `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  )
  const parts = text.split(regex)

  return parts.map((part, index) =>
    regex.test(part) ? (
      <span key={part} className="bg-yellow-500/30 text-yellow-200">
        {part}
      </span>
    ) : (
      part
    )
  )
}

export function MainWindow() {
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const {
    data: filteredThoughts,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.getThoughts.useQuery(
    debouncedSearchQuery.trim() ? { search: debouncedSearchQuery } : undefined,
    {
      retry: 2,
    }
  )

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-900 text-white select-none">
      <div
        className="flex flex-row border-b border-zinc-800 px-2 min-h-[28px] py-2"
        data-tauri-drag-region
      />

      <div className="p-4 border-b border-zinc-800">
        <input
          type="text"
          placeholder="Search thoughts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="animate-pulse text-zinc-400">
              Loading thoughts...
            </div>
          </div>
        ) : !filteredThoughts || isError ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-red-400">
              {error?.message || "Failed to load thoughts"}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        ) : filteredThoughts?.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            {searchQuery.trim()
              ? "No thoughts match your search."
              : "No thoughts yet. Press ⌘+K to create one!"}
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-6 overflow-y-auto h-full dark-scrollbar">
            {filteredThoughts?.map((thought) => {
              const images = parseImagesFromMetadata(
                thought.metadata as unknown as string | null
              )
              return (
                <div
                  key={thought.id}
                  className="group flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-4 hover:bg-zinc-800 transition-colors"
                >
                  <div className="whitespace-pre-wrap text-zinc-100 select-none">
                    <span className="select-text w-min">
                      {highlightMatches(thought.content, debouncedSearchQuery)}
                    </span>
                  </div>

                  {images.length > 0 && (
                    <div className="flex flex-row flex-wrap gap-2">
                      {images.map((img) => (
                        <img
                          key={`${img.mimeType}-${img.dataUri.slice(0, 32)}`}
                          src={img.dataUri}
                          alt={`pasted-${img.mimeType}`}
                          className="rounded-md max-h-48 border border-zinc-700"
                        />
                      ))}
                    </div>
                  )}

                  <div className="text-sm text-zinc-500">
                    {format(
                      new Date(thought.timestamp),
                      "MMM d, yyyy 'at' h:mm a"
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
