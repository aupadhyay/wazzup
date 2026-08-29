import { trpc } from "../api"
import { useEffect, useState, useMemo, useRef } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { invoke } from "@tauri-apps/api/core"
import "./scrollbar.css"
import type { ContextInfo, Image, LocationInfo } from "./quick-panel"
import { SudoCountdown, useSudo } from "../lib/use-sudo"
import { CloudSettings } from "./cloud-settings"

function parseImagesFromMetadata(metadata?: string | null): Image[] {
  if (!metadata) return []
  try {
    const parsed = JSON.parse(metadata) as ContextInfo
    return Array.isArray(parsed?.images) ? (parsed?.images as Image[]) : []
  } catch {
    return []
  }
}

function parseLocationFromMetadata(
  metadata?: string | null
): LocationInfo | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as ContextInfo
    return parsed?.location ?? null
  } catch {
    return null
  }
}

function formatTimestampWithTimeZone(
  timestamp: string,
  location: LocationInfo | null
): { formatted: string; note?: string } {
  // The timestamp from DB is in UTC format: "2026-01-09 02:31:40"
  // We need to treat it as UTC before converting
  const utcTimestamp = timestamp.includes("Z") ? timestamp : `${timestamp}Z`

  if (location?.timeZone) {
    // Convert from UTC to location's timezone
    const formatted = formatInTimeZone(
      utcTimestamp,
      location.timeZone,
      "MMM d, yyyy 'at' h:mm a zzz"
    )
    return {
      formatted,
      note: "converted from location",
    }
  }

  // Fallback to EST
  const formatted = formatInTimeZone(
    utcTimestamp,
    "America/New_York",
    "MMM d, yyyy 'at' h:mm a zzz"
  )
  return { formatted }
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
  const [settingsOpen, setSettingsOpen] = useState(false)

  const sudo = useSudo()
  const utils = trpc.useUtils()
  const setAccessLevel = trpc.setThoughtAccessLevel.useMutation({
    onSuccess: () => {
      void utils.getThoughtsPaginated.invalidate()
      void utils.getThoughts.invalidate()
    },
  })

  const handleReplayClick = async (thoughtId: number) => {
    try {
      await invoke("open_replay_window", { thoughtId })
    } catch (error) {
      console.error("Failed to open replay window:", error)
    }
  }

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = trpc.getThoughtsPaginated.useInfiniteQuery(
    {
      limit: 20,
      search: debouncedSearchQuery.trim() || undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      retry: 2,
    }
  )

  const filteredThoughts = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  )

  // IntersectionObserver for infinite scroll
  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = observerTarget.current
    if (!target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-900 text-white select-none">
      <div
        className="flex flex-row border-b border-zinc-800 px-2 min-h-[28px] py-2"
        data-tauri-drag-region
      />

      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <input
          type="text"
          placeholder={
            sudo.active ? "Search all thoughts (sudo)..." : "Search thoughts..."
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
        />
        {sudo.active && sudo.expiresAtMs ? (
          <button
            type="button"
            onClick={() => void sudo.lock()}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 text-sm hover:bg-amber-500/30"
            title="Click to end the sudo session now"
          >
            🔓 <SudoCountdown expiresAtMs={sudo.expiresAtMs} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void sudo.unlock()}
            disabled={sudo.busy || !sudo.enrolled}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-sm hover:bg-zinc-700 disabled:opacity-40"
            title={
              sudo.enrolled
                ? "Unlock sudo thoughts with Touch ID"
                : "Enroll sudo mode in settings first"
            }
          >
            {sudo.busy ? "..." : "🔒 sudo"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-sm hover:bg-zinc-700"
          title="Cloud & sudo settings"
        >
          ⚙
        </button>
      </div>

      {sudo.error && (
        <div className="px-4 py-2 text-xs text-amber-400 border-b border-zinc-800">
          {sudo.error}
        </div>
      )}

      {settingsOpen && <CloudSettings onClose={() => setSettingsOpen(false)} />}

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
              const location = parseLocationFromMetadata(
                thought.metadata as unknown as string | null
              )
              const timestampInfo = formatTimestampWithTimeZone(
                thought.timestamp,
                location
              )

              console.log("timestampInfo", timestampInfo)
              console.log("thought.timestamp", thought.timestamp)
              console.log("location", location)

              return (
                <div
                  key={thought.id}
                  className={
                    thought.accessLevel === "sudo"
                      ? "group flex flex-col gap-2 bg-amber-950/30 border border-amber-500/20 rounded-xl p-4 hover:bg-amber-950/40 transition-colors"
                      : "group flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-4 hover:bg-zinc-800 transition-colors"
                  }
                >
                  <div className="flex items-center justify-between -mb-1">
                    {thought.accessLevel === "sudo" ? (
                      <span className="text-xs text-amber-400/80">🔒 sudo</span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setAccessLevel.mutate({
                          uuid: thought.uuid,
                          level:
                            thought.accessLevel === "sudo" ? "standard" : "sudo",
                        })
                      }
                      disabled={setAccessLevel.isPending}
                      className="opacity-0 group-hover:opacity-100 text-xs text-zinc-400 hover:text-zinc-200 transition-opacity"
                      title={
                        thought.accessLevel === "sudo"
                          ? "Make standard (requires active sudo session)"
                          : "Mark as sudo — hides it everywhere until unlocked"
                      }
                    >
                      {thought.accessLevel === "sudo"
                        ? "make standard"
                        : "mark as sudo"}
                    </button>
                  </div>
                  {thought.hasEditHistory && (
                    <button
                      type="button"
                      onClick={() => handleReplayClick(thought.id)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 cursor-pointer transition-colors mb-1 w-fit"
                      title="Click to view edit history"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      <span>Edited</span>
                    </button>
                  )}
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
                    {timestampInfo.formatted}
                    {timestampInfo.note && (
                      <span className="text-zinc-600 ml-1">
                        ({timestampInfo.note})
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Sentinel element for infinite scroll */}
            <div ref={observerTarget} className="h-4" />

            {/* Loading indicator */}
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <div className="animate-pulse text-zinc-400">
                  Loading more thoughts...
                </div>
              </div>
            )}

            {/* End of list indicator */}
            {!hasNextPage && filteredThoughts.length > 0 && (
              <div className="flex justify-center py-4 text-zinc-500 text-sm">
                No more thoughts to load
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
