import { useMemo } from "react"

interface EditorViewProps {
  content: string
  cursorPosition: number
}

export function EditorView({ content, cursorPosition }: EditorViewProps) {
  const { beforeCursor, afterCursor } = useMemo(() => {
    return {
      beforeCursor: content.slice(0, cursorPosition),
      afterCursor: content.slice(cursorPosition),
    }
  }, [content, cursorPosition])

  return (
    <div className="font-mono text-base leading-relaxed">
      <div className="relative whitespace-pre-wrap break-words text-zinc-100">
        <span>{beforeCursor}</span>
        <span className="inline-block w-[2px] h-5 bg-green-500 animate-blink" />
        <span>{afterCursor}</span>
      </div>

      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .animate-blink {
          animation: blink 1s infinite;
        }
      `}</style>
    </div>
  )
}
