import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { trpc } from "../api"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { cn } from "../lib/utils"

export interface SpotifyTrackInfo {
  artist: string
  track: string
}

export interface FocusedAppInfo {
  name: string
  bundleId: string
}

export interface LocationInfo {
  time_local: string
  subThoroughfare?: string
  name?: string
  altitude: string
  h_accuracy: string
  thoroughfare?: string
  region: string
  locality?: string
  administrativeArea?: string
  longitude: string
  timeZone: string
  direction: string
  isoCountryCode?: string
  subLocality?: string
  latitude: string
  time: string
  address?: string
  subAdministrativeArea?: string
  speed: string
  postalCode?: string
  v_accuracy: string
  country?: string
}

export interface Image {
  mimeType: string
  dataUri: string
}

export interface ContextInfo {
  url?: string
  spotify?: SpotifyTrackInfo
  focusedApp?: FocusedAppInfo
  location?: LocationInfo
  images?: Image[]
}

function computeEditOperation(
  prevText: string,
  newText: string,
  cursorPos: number
): {
  type: "insert" | "delete" | "replace"
  position: number
  content: string
} | null {
  if (prevText === newText) return null

  // Find the longest common prefix
  let prefixLen = 0
  const minLen = Math.min(prevText.length, newText.length)
  while (prefixLen < minLen && prevText[prefixLen] === newText[prefixLen]) {
    prefixLen++
  }

  // Find the longest common suffix
  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    prevText[prevText.length - 1 - suffixLen] ===
      newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const deletedContent = prevText.slice(prefixLen, prevText.length - suffixLen)
  const insertedContent = newText.slice(prefixLen, newText.length - suffixLen)

  // Determine operation type
  if (deletedContent && insertedContent) {
    // Replace operation (e.g., selected text and typed over it)
    return { type: "replace", position: prefixLen, content: insertedContent }
  }
  if (insertedContent) {
    // Insert operation
    return { type: "insert", position: prefixLen, content: insertedContent }
  }
  if (deletedContent) {
    // Delete operation
    return { type: "delete", position: prefixLen, content: deletedContent }
  }

  return null
}

export function QuickPanel() {
  const [input, setInput] = useState("")
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null)
  const [pastedImages, setPastedImages] = useState<
    { mimeType: string; dataUri: string }[]
  >([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Record mode state
  const [recordMode, setRecordMode] = useState(false)
  const [editCount, setEditCount] = useState(0)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [currentSessionId] = useState(() => -Date.now()) // Temp ID for edit history
  const [sequenceNum, setSequenceNum] = useState(0)
  const lastInputValueRef = useRef("") // Track exact previous value for diffing

  const { mutate: createThought } = trpc.createThought.useMutation()
  const { mutate: createEditOperation } = trpc.createEditOperation.useMutation()
  const { mutate: updateHistoryThoughtId } =
    trpc.updateEditOperationsThoughtId.useMutation()
  const { mutate: deleteHistory } = trpc.deleteEditOperations.useMutation()

  const fetchContextInfo = async () => {
    const [url, spotifyInfo, focusedAppInfo, locationInfo] =
      await Promise.allSettled([
        invoke<string>("active_arc_url"),
        invoke<SpotifyTrackInfo>("get_spotify_track"),
        invoke<FocusedAppInfo>("get_focused_app"),
        invoke<LocationInfo>("get_location"),
      ])

    setContextInfo({
      url: url.status === "fulfilled" ? url.value : undefined,
      spotify: spotifyInfo.status === "fulfilled" ? spotifyInfo.value : undefined,
      focusedApp: focusedAppInfo.status === "fulfilled" ? focusedAppInfo.value : undefined,
      location: locationInfo.status === "fulfilled" ? locationInfo.value : undefined,
    })
  }

  useEffect(() => {
    const window = getCurrentWindow()

    const unlistenVisibilityChange = window.onFocusChanged(
      ({ payload: focused }) => {
        if (focused) {
          fetchContextInfo()
        }
      }
    )

    fetchContextInfo()
    inputRef.current?.focus()

    return () => {
      unlistenVisibilityChange.then((unlisten) => unlisten())
    }
  }, [])

  useEffect(() => {
    const textarea = inputRef.current
    if (textarea) {
      // Reset height to auto to get proper scrollHeight
      textarea.style.height = "auto"
      // Set the height to scrollHeight which includes wrapped content
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [input])

  // Immediate edit tracking (no debouncing)
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const prevValue = lastInputValueRef.current

    setInput(newValue)

    if (recordMode) {
      const operation = computeEditOperation(
        prevValue,
        newValue,
        e.target.selectionStart || 0
      )

      if (operation) {
        const newSeqNum = sequenceNum + 1
        setSequenceNum(newSeqNum)
        setEditCount(newSeqNum) // editCount = total operations

        createEditOperation(
          {
            thought_id: currentSessionId,
            sequence_num: newSeqNum,
            operation_type: operation.type,
            position: operation.position,
            content: operation.content,
            timestamp_ms: Date.now(),
          },
          {
            onError: (err) => console.error("Failed to record operation:", err),
          }
        )
      }
    }

    lastInputValueRef.current = newValue
  }

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    // Cmd+R to toggle record mode
    if (e.metaKey && e.key.toLowerCase() === "r") {
      e.preventDefault()
      try {
        const newState = await invoke<boolean>("toggle_record_mode")
        setRecordMode(newState)
        if (!newState && editCount > 0) {
          // Reset state when turning off
          setEditCount(0)
          setSequenceNum(0)
          setConfirmingDiscard(false)
          lastInputValueRef.current = ""
        }
      } catch (err) {
        console.error("Failed to toggle record mode", err)
      }
      return
    }

    // Handle inline confirmation state
    if (confirmingDiscard) {
      if (e.key.toLowerCase() === "y") {
        e.preventDefault()
        // Discard history and close
        deleteHistory({ thought_id: currentSessionId })
        setEditCount(0)
        setSequenceNum(0)
        setRecordMode(false)
        setConfirmingDiscard(false)
        lastInputValueRef.current = ""
        const window = getCurrentWindow()
        window.hide()
        return
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        // Keep history and submit thought (fall through to normal submission)
        setConfirmingDiscard(false)
        // Continue to Enter submission logic below
      }
      if (e.key === "Escape") {
        e.preventDefault()
        // Cancel confirmation, return to editing
        setConfirmingDiscard(false)
        return
      }
      // Any other key returns to editing
      return
    }

    if (e.metaKey && e.key.toLowerCase() === "k") {
      e.preventDefault()
      try {
        await invoke("open_main_window")
      } catch (err) {
        console.error("Failed to open main window", err)
      }
      return
    }

    if (e.key === "Escape") {
      if (recordMode && editCount > 0) {
        // Show inline confirmation
        setConfirmingDiscard(true)
      } else {
        const window = getCurrentWindow()
        window.hide()
      }
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const trimmedInput = input.trim()
      if (trimmedInput) {
        let thoughtText = trimmedInput

        if (contextInfo) {
          thoughtText += `\n\nFrom: ${contextInfo.url}`
          if (contextInfo.focusedApp) {
            thoughtText += `\nFocused app: ${contextInfo.focusedApp.name}`
          }
          if (
            contextInfo.spotify &&
            contextInfo.spotify.artist !== "Not playing"
          ) {
            thoughtText += `\nListening to: ${contextInfo.spotify.track} by ${contextInfo.spotify.artist}`
          }
          if (contextInfo.location) {
            const loc = contextInfo.location
            if (loc.address) {
              thoughtText += `\nLocation: ${loc.address}`
            } else if (loc.locality && loc.administrativeArea) {
              thoughtText += `\nLocation: ${loc.locality}, ${loc.administrativeArea}`
            } else if (loc.name) {
              thoughtText += `\nLocation: ${loc.name}`
            }
          }
        }

        const metadata = {
          url: contextInfo?.url ?? null,
          spotify: contextInfo?.spotify ?? null,
          focusedApp: contextInfo?.focusedApp ?? null,
          location: contextInfo?.location ?? null,
          images: pastedImages.map((img) => ({
            mimeType: img.mimeType,
            dataUri: img.dataUri,
          })),
        }

        createThought(
          { content: thoughtText, metadata: JSON.stringify(metadata) },
          {
            onSuccess: (newThought) => {
              // Update edit history with real thought ID if recording
              if (recordMode && editCount > 0) {
                updateHistoryThoughtId({
                  old_thought_id: currentSessionId,
                  new_thought_id: newThought.id,
                })
              }

              setInput("")
              setPastedImages([])
              setEditCount(0)
              setSequenceNum(0)
              setRecordMode(false)
              setConfirmingDiscard(false)
              lastInputValueRef.current = ""
            },
            onError: (error) => {
              console.error(error)
              setInput(`Error: ${error.message}`)
            },
          }
        )
      }
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imagePromises: Promise<{
      mimeType: string
      dataUri: string
    } | null>[] = []
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          imagePromises.push(
            new Promise((resolve) => {
              const reader = new FileReader()
              reader.onload = () => {
                resolve({
                  mimeType: file.type,
                  dataUri: reader.result as string,
                })
              }
              reader.onerror = () => resolve(null)
              reader.readAsDataURL(file)
            })
          )
        }
      }
    }

    const images = (await Promise.all(imagePromises)).filter(
      (x): x is { mimeType: string; dataUri: string } => Boolean(x)
    )
    if (images.length > 0) {
      setPastedImages((prev) => [...prev, ...images])
    }
  }

  const truncateUrl = (url: string) => {
    if (url.length > 50) {
      return `${url.substring(0, 47)}...`
    }
    return url
  }

  return (
    <div className="flex w-full items-start justify-center h-auto">
      <div
        className="w-[600px] bg-[#1e1e1e] pt-2 pb-1 px-2 rounded-xl overflow-hidden relative"
        data-tauri-drag-region
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="w-full px-2 bg-transparent text-white text-lg outline-none placeholder:text-white/50 resize-none overflow-hidden leading-[20px]"
          placeholder="wazzzzzup"
          rows={1}
        />
        <div className="w-full px-2">
          {/* Record mode indicator with inline confirmation */}
          {confirmingDiscard && (
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-1 backdrop-blur-sm rounded-lg border transition-colors duration-200",
                confirmingDiscard
                  ? "bg-yellow-500/20 border-yellow-500/30"
                  : "bg-red-500/20 border-red-500/30"
              )}
            >
              {confirmingDiscard && (
                <>
                  <span className="text-xs text-yellow-300 font-medium">
                    ⚠ Discard history?
                  </span>
                  <span className="text-xs text-yellow-400/60">(y/n)</span>
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 min-w-2">
            <div
              className={cn(
                "w-2 h-2 mb-[2px] border-1 border-white/50 rounded-full",
                recordMode
                  ? "bg-white border-white animate-pulse"
                  : "animate-none"
              )}
            />
            <span
              className={cn(
                "text-xs text-white/50 font-medium",
                recordMode ? "text-white animate-pulse" : "text-white/50"
              )}
            >
              {recordMode ? "Live" : "Static"}
            </span>
            <span
              className={cn(
                "text-xs text-white/50",
                recordMode ? "text-white animate-pulse" : "text-white/50"
              )}
            >
              (⌘R)
            </span>
          </div>
        </div>
        {(contextInfo || pastedImages.length > 0) && (
          <div className="text-white/50 text-xs px-2 pb-1 pt-0.5">
            {contextInfo && (
              <>
                {truncateUrl(contextInfo.url ?? "")}
                {contextInfo.focusedApp && (
                  <span>{`${contextInfo.url ? " • " : ""}${contextInfo.focusedApp.name}`}</span>
                )}
                {contextInfo.spotify &&
                  contextInfo.spotify.artist !== "Not playing" && (
                    <span>{` • ${contextInfo.spotify.track} by ${contextInfo.spotify.artist}`}</span>
                  )}
                {contextInfo.location && (
                  <span>
                    {" • "}
                    {contextInfo.location.address ||
                      (contextInfo.location.locality &&
                      contextInfo.location.administrativeArea
                        ? `${contextInfo.location.locality}, ${contextInfo.location.administrativeArea}`
                        : contextInfo.location.name || "Unknown location")}
                  </span>
                )}
              </>
            )}
            {pastedImages.length > 0 && (
              <span>{`${contextInfo ? " • " : ""}Pasted image${pastedImages.length > 1 ? "s" : ""} (${pastedImages.length})`}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
