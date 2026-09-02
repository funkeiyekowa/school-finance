"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, X, Loader2 } from "lucide-react";
import { AiAssistButton } from "@/components/ai/AiAssistButton";
import type { Message } from "@/lib/messaging/types";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (body: string, attachments: File[]) => Promise<void>;
  replyTo: Message | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  onTyping: (typing: boolean) => void;
  showAiAssist: boolean;
  maxAttachmentMb: number;
  allowedAttachmentTypes: string[];
}

export function Composer({
  onSend, replyTo, onCancelReply, editing, onCancelEdit, onSaveEdit,
  disabled, disabledReason, onTyping, showAiAssist, maxAttachmentMb, allowedAttachmentTypes,
}: Props) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeBody = editing ? body || editing.body || "" : body;

  function handleChange(v: string) {
    setBody(v);
    onTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 2000);
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > maxAttachmentMb * 1024 * 1024) {
        setError(`${f.name} is over the ${maxAttachmentMb}MB limit`);
        continue;
      }
      if (allowedAttachmentTypes.length > 0 && !allowedAttachmentTypes.includes(f.type)) {
        setError(`${f.name} is not an allowed file type`);
        continue;
      }
      picked.push(f);
    }
    setFiles((prev) => [...prev, ...picked]);
  }

  async function submit() {
    if (editing) {
      if (!activeBody.trim()) return;
      await onSaveEdit(activeBody.trim());
      setBody("");
      return;
    }
    if (!activeBody.trim() && files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      await onSend(activeBody.trim(), files);
      setBody("");
      setFiles([]);
      onTyping(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      {disabled && disabledReason && (
        <div className="mb-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{disabledReason}</div>
      )}
      {replyTo && !editing && (
        <div className="flex items-center justify-between bg-gray-50 border-l-2 border-[#0F2A47] rounded-lg px-3 py-1.5 mb-2 text-xs">
          <span className="truncate">Replying to <strong>{replyTo.sender_name}</strong>: {replyTo.body || "attachment"}</span>
          <button type="button" onClick={onCancelReply}><X size={14} /></button>
        </div>
      )}
      {editing && (
        <div className="flex items-center justify-between bg-amber-50 border-l-2 border-amber-400 rounded-lg px-3 py-1.5 mb-2 text-xs">
          <span>Editing message</span>
          <button type="button" onClick={onCancelEdit}><X size={14} /></button>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2 py-1 text-xs">
              <span className="truncate max-w-[140px]">{f.name}</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      <div className="flex items-end gap-2">
        {!editing && (
          <>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
              title="Attach a file"
            >
              <Paperclip size={18} />
            </button>
          </>
        )}
        <textarea
          value={activeBody}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? "You cannot send messages here" : "Write a message… (Enter to send, Shift+Enter for a new line)"}
          className={cn(
            "flex-1 resize-none border border-gray-300 rounded-2xl px-4 py-2.5 text-sm max-h-32",
            "focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent disabled:bg-gray-50"
          )}
        />
        {showAiAssist && !disabled && (
          <AiAssistButton
            kinds={["message_polish", "message_shorten", "message_translate"]}
            currentValue={activeBody}
            onApply={(text) => setBody(text)}
            source="messages.composer"
            compact
          />
        )}
        <button
          type="button"
          disabled={disabled || sending || (!activeBody.trim() && files.length === 0)}
          onClick={submit}
          className="p-2.5 rounded-full bg-[#0F2A47] text-white hover:bg-[#1B3E63] disabled:opacity-40 flex-shrink-0"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
