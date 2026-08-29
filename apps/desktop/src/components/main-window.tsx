import { invoke } from "@tauri-apps/api/core";
import { formatInTimeZone } from "date-fns-tz";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  History,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import "./scrollbar.css";
import type { ContextInfo, Image, LocationInfo } from "./quick-panel";

interface ParsedMetadata {
  images: Image[];
  location: LocationInfo | null;
  url: string | null;
}

interface CopyableThought {
  id: number;
  content: string;
  metadata: unknown;
  timestamp: string;
}

function parseMetadata(metadata?: string | null): ParsedMetadata {
  if (!metadata) return { images: [], location: null, url: null };

  try {
    const parsed = JSON.parse(metadata) as ContextInfo;
    return {
      images: Array.isArray(parsed?.images) ? parsed.images : [],
      location: parsed?.location ?? null,
      url: parsed?.url ?? null,
    };
  } catch {
    return { images: [], location: null, url: null };
  }
}

function formatTimestampWithTimeZone(
  timestamp: string,
  location: LocationInfo | null,
): string {
  const utcTimestamp = timestamp.includes("Z") ? timestamp : `${timestamp}Z`;
  const timeZone = location?.timeZone ?? "America/New_York";
  return formatInTimeZone(
    utcTimestamp,
    timeZone,
    "MMM d, yyyy 'at' h:mm a zzz",
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

function highlightMatches(text: string, searchQuery: string): React.ReactNode {
  if (!searchQuery.trim()) return text;

  const regex = new RegExp(
    `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  const parts = text.split(regex);

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-amber-300/20 px-0.5 text-amber-100"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function timestampToMilliseconds(timestamp: string): number {
  const utcTimestamp = timestamp.includes("Z") ? timestamp : `${timestamp}Z`;
  return new Date(utcTimestamp).getTime();
}

function formatThoughtsForClipboard(thoughts: CopyableThought[]): string {
  return [...thoughts]
    .sort((first, second) => {
      const timestampDifference =
        timestampToMilliseconds(first.timestamp) -
        timestampToMilliseconds(second.timestamp);
      return timestampDifference || first.id - second.id;
    })
    .map((thought) => {
      const metadata = parseMetadata(
        thought.metadata as string | null | undefined,
      );
      const timestamp = formatTimestampWithTimeZone(
        thought.timestamp,
        metadata.location,
      );
      const urlContext = metadata.url ? `\nURL: ${metadata.url}` : "";
      return `[${timestamp}] ${thought.content.trim()}${urlContext}`;
    })
    .join("\n\n");
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const didCopy = document.execCommand("copy");
    textarea.remove();
    if (!didCopy) throw new Error("Clipboard access was denied");
  }
}

export function MainWindow() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeThoughtId, setActiveThoughtId] = useState<number | null>(null);
  const [selectedThoughts, setSelectedThoughts] = useState<
    Map<number, CopyableThought>
  >(() => new Map());
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const thoughtRefs = useRef(new Map<number, HTMLDivElement>());
  const copyMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    },
  );

  const filteredThoughts = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  const handleReplayClick = async (thoughtId: number) => {
    try {
      await invoke("open_replay_window", { thoughtId });
    } catch (replayError) {
      console.error("Failed to open replay window:", replayError);
    }
  };

  const showCopyMessage = useCallback((message: string) => {
    if (copyMessageTimerRef.current) {
      clearTimeout(copyMessageTimerRef.current);
    }
    setCopyMessage(message);
    copyMessageTimerRef.current = setTimeout(() => setCopyMessage(null), 1800);
  }, []);

  const toggleThought = useCallback((thought: CopyableThought) => {
    setSelectedThoughts((current) => {
      const next = new Map(current);
      if (next.has(thought.id)) {
        next.delete(thought.id);
      } else {
        next.set(thought.id, thought);
      }
      return next;
    });
  }, []);

  const copySelectedThoughts = useCallback(async () => {
    if (selectedThoughts.size === 0) {
      showCopyMessage("Select thoughts with Space first");
      return;
    }

    try {
      await writeToClipboard(
        formatThoughtsForClipboard([...selectedThoughts.values()]),
      );
      showCopyMessage(
        `Copied ${selectedThoughts.size} thought${
          selectedThoughts.size === 1 ? "" : "s"
        } chronologically`,
      );
    } catch (clipboardError) {
      console.error("Failed to copy thoughts:", clipboardError);
      showCopyMessage("Could not access the clipboard");
    }
  }, [selectedThoughts, showCopyMessage]);

  useEffect(() => {
    if (
      filteredThoughts.length > 0 &&
      !filteredThoughts.some((thought) => thought.id === activeThoughtId)
    ) {
      setActiveThoughtId(filteredThoughts[0].id);
    }
  }, [activeThoughtId, filteredThoughts]);

  useEffect(() => {
    if (activeThoughtId === null) return;
    thoughtRefs.current
      .get(activeThoughtId)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeThoughtId]);

  useEffect(() => {
    return () => {
      if (copyMessageTimerRef.current) {
        clearTimeout(copyMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isEditing) return;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        filteredThoughts.length > 0
      ) {
        event.preventDefault();
        const currentIndex = filteredThoughts.findIndex(
          (thought) => thought.id === activeThoughtId,
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          currentIndex < 0
            ? 0
            : Math.min(
                filteredThoughts.length - 1,
                Math.max(0, currentIndex + direction),
              );
        setActiveThoughtId(filteredThoughts[nextIndex].id);
        return;
      }

      if (event.key === " " && activeThoughtId !== null) {
        const activeThought = filteredThoughts.find(
          (thought) => thought.id === activeThoughtId,
        );
        if (!activeThought) return;
        event.preventDefault();
        toggleThought(activeThought);
        return;
      }

      if (
        event.key.toLowerCase() === "c" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !window.getSelection()?.toString()
      ) {
        event.preventDefault();
        void copySelectedThoughts();
        return;
      }

      if (event.key === "Escape" && selectedThoughts.size > 0) {
        event.preventDefault();
        setSelectedThoughts(new Map());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeThoughtId,
    copySelectedThoughts,
    filteredThoughts,
    selectedThoughts.size,
    toggleThought,
  ]);

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#101112] text-zinc-100">
      <div
        className="min-h-9 border-b border-white/[0.06]"
        data-tauri-drag-region
      />

      <header className="border-b border-white/[0.07] bg-[#121315]/95 px-6 pb-5 pt-4">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                Library
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
                Thoughts
              </h1>
            </div>
            <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
              <span>{filteredThoughts.length} loaded</span>
              <span className="text-zinc-700">·</span>
              <span>{selectedThoughts.size} selected</span>
            </div>
          </div>

          <div className="group relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-amber-300"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search thoughts…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                if (searchQuery) {
                  setSearchQuery("");
                } else {
                  event.currentTarget.blur();
                }
              }}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] py-2 pl-10 pr-14 text-sm text-zinc-100 shadow-inner shadow-black/20 outline-none transition placeholder:text-zinc-600 focus:border-amber-300/40 focus:bg-white/[0.065] focus:ring-2 focus:ring-amber-300/10"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-sans text-[11px] text-zinc-500">
              /
            </kbd>
          </div>
        </div>
      </header>

      <div className="border-b border-white/[0.06] px-6 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 text-[11px] text-zinc-500">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="text-zinc-300">↑↓</kbd> move
            </span>
            <span>
              <kbd className="text-zinc-300">Space</kbd> select
            </span>
            <span>
              <kbd className="text-zinc-300">C</kbd> copy selected
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedThoughts(new Map())}
            className={`transition-colors hover:text-zinc-200 ${
              selectedThoughts.size === 0 ? "invisible" : ""
            }`}
          >
            Esc to clear
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="animate-pulse text-sm text-zinc-500">
              Loading thoughts...
            </div>
          </div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-sm text-red-300">
              {error?.message || "Failed to load thoughts"}
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm transition-colors hover:bg-white/[0.09]"
            >
              Try again
            </button>
          </div>
        ) : filteredThoughts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            {searchQuery.trim()
              ? "No thoughts match your search."
              : "No thoughts yet. Press ⌘+K to create one!"}
          </div>
        ) : (
          <div className="dark-scrollbar h-full overflow-y-auto px-6 py-5">
            <div
              className={`mx-auto flex max-w-4xl flex-col gap-2 ${
                selectedThoughts.size > 0 ? "pb-20" : ""
              }`}
              role="listbox"
              aria-label="Thoughts"
              aria-multiselectable="true"
            >
              {filteredThoughts.map((thought) => {
                const metadata = parseMetadata(
                  thought.metadata as unknown as string | null,
                );
                const timestamp = formatTimestampWithTimeZone(
                  thought.timestamp,
                  metadata.location,
                );
                const isActive = thought.id === activeThoughtId;
                const isSelected = selectedThoughts.has(thought.id);

                return (
                  <div
                    key={thought.id}
                    ref={(element) => {
                      if (element) {
                        thoughtRefs.current.set(thought.id, element);
                      } else {
                        thoughtRefs.current.delete(thought.id);
                      }
                    }}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onClick={() => {
                      setActiveThoughtId(thought.id);
                      if (!window.getSelection()?.toString()) {
                        toggleThought(thought);
                      }
                    }}
                    className={`group relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-xl border px-3 py-3.5 transition-all ${
                      isSelected
                        ? "border-amber-300/35 bg-amber-200/[0.07]"
                        : isActive
                          ? "border-white/[0.14] bg-white/[0.055]"
                          : "border-transparent bg-white/[0.025] hover:bg-white/[0.045]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveThoughtId(thought.id);
                        toggleThought(thought);
                      }}
                      className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                        isSelected
                          ? "border-amber-300 bg-amber-300 text-zinc-950"
                          : "border-zinc-700 text-transparent hover:border-zinc-500"
                      }`}
                      aria-label={
                        isSelected ? "Deselect thought" : "Select thought"
                      }
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>

                    <div className="min-w-0">
                      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="h-3 w-3" aria-hidden="true" />
                          {timestamp}
                        </span>
                        {metadata.url && (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ExternalLink
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="max-w-72 truncate">
                              {metadata.url}
                            </span>
                          </span>
                        )}
                        {thought.hasEditHistory && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleReplayClick(thought.id);
                            }}
                            className="flex items-center gap-1 transition-colors hover:text-zinc-200"
                            title="View edit history"
                          >
                            <History className="h-3 w-3" aria-hidden="true" />
                            Edited
                          </button>
                        )}
                      </div>

                      <div className="whitespace-pre-wrap">
                        <span className="select-text text-[15px] leading-7 text-zinc-200">
                          {highlightMatches(
                            thought.content,
                            debouncedSearchQuery,
                          )}
                        </span>
                      </div>

                      {metadata.images.length > 0 && (
                        <div className="mt-3 flex flex-row flex-wrap gap-2">
                          {metadata.images.map((image) => (
                            <img
                              key={`${image.mimeType}-${image.dataUri.slice(0, 32)}`}
                              src={image.dataUri}
                              alt={`pasted-${image.mimeType}`}
                              className="max-h-56 rounded-lg border border-white/10"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {isActive && (
                      <div className="pointer-events-none absolute inset-y-3 left-0 w-0.5 rounded-full bg-amber-300/80" />
                    )}
                  </div>
                );
              })}

              <div ref={observerTarget} className="h-4" />

              {isFetchingNextPage && (
                <div className="flex justify-center py-4">
                  <div className="animate-pulse text-xs text-zinc-500">
                    Loading more thoughts...
                  </div>
                </div>
              )}

              {!hasNextPage && (
                <div className="flex items-center justify-center gap-3 py-5 text-[11px] uppercase tracking-[0.16em] text-zinc-700">
                  <span className="h-px w-8 bg-white/[0.06]" />
                  End of thoughts
                  <span className="h-px w-8 bg-white/[0.06]" />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {selectedThoughts.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-10 flex justify-center px-6">
          <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-white/[0.12] bg-zinc-900/95 p-2 pl-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2.5">
              <CheckCircle2
                className="h-4 w-4 shrink-0 text-amber-300"
                aria-hidden="true"
              />
              <span className="truncate text-sm text-zinc-300">
                {selectedThoughts.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedThoughts(new Map())}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-200"
              >
                Clear
              </button>
            </div>
            <button
              type="button"
              onClick={() => void copySelectedThoughts()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-300 px-3.5 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-200"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy chronological
              <kbd className="rounded bg-black/10 px-1.5 py-0.5 font-sans text-[10px]">
                C
              </kbd>
            </button>
          </div>
        </div>
      )}

      {copyMessage && (
        <div
          className="pointer-events-none fixed right-5 top-12 z-20 rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 shadow-xl"
          role="status"
        >
          {copyMessage}
        </div>
      )}
    </div>
  );
}
