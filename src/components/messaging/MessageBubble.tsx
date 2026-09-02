"use client";

import { useState } from "react";
import { Avatar } from "@/components/messaging/Avatar";
import { REACTION_EMOJIS, type Message } from "@/lib/messaging/types";
import { formatFileSize } from "@/lib/messaging/storage";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Reply, Pin, Pencil, Trash2, Flag, Smile, FileText, Image as ImageIcon, Download } from "lucide-react";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface Props {
  message: Message;
  mine: boolean;
  showSender: boolean;
  isGroup: boolean;
  canModerate: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReport: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onPin: (m: Message, pinned: boolean) => void;
  onOpenAttachment: (path: string, fileName: string) => void;
  myUserId: string;
}

export function MessageBubble({
  message, mine, showSender, isGroup, canModerate, onReply, onEdit, onDelete, onReport, onReact, onPin, onOpenAttachment, myUserId,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  if (message.deleted_at) {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className="italic text-xs text-gray-400 px-3 py-2">
          {message.removed_by_moderator ? "Message removed by a moderator" : "Message deleted"}
        </div>
      </div>
    );
  }

  const reactionCounts = (message.reactions ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});
  const iReacted = new Set((message.reactions ?? []).filter((r) => r.user_id === myUserId).map((r) => r.emoji));

  return (
    <div className={cn("flex gap-2 group", mine ? "justify-end" : "justify-start")}>
      {!mine && isGroup && (
        <Avatar name={message.sender_name || "?"} seed={message.sender_id} size={30} className="mt-4" />
      )}
      <div className={cn("max-w-[75%] flex flex-col", mine ? "items-end" : "items-start")}>
        {showSender && !mine && isGroup && (
          <span className="text-xs font-semibold text-gray-500 mb-0.5 px-1">{message.sender_name}</span>
        )}
        {message.pinned_at && (
          <span className="flex items-center gap-1 text-[11px] text-[#C9A227] font-medium mb-0.5 px-1">
            <Pin size={11} /> Pinned
          </span>
        )}
        {message.reply_to && (
          <div className={cn(
            "text-xs px-2.5 py-1.5 rounded-lg mb-0.5 border-l-2 max-w-full truncate",
            mine ? "bg-[#1B3E63]/10 border-[#0F2A47] text-[#0F2A47]" : "bg-gray-100 border-gray-300 text-gray-600"
          )}>
            {message.reply_to.body || "Attachment"}
          </div>
        )}

        <div className="relative flex items-end gap-1">
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2 text-sm shadow-sm break-words whitespace-pre-wrap",
              mine ? "bg-[#0F2A47] text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
            )}
          >
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-1">
                {message.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenAttachment(a.storage_path, a.file_name)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                      mine ? "bg-white/10 hover:bg-white/20" : "bg-gray-50 hover:bg-gray-100 border border-gray-200"
                    )}
                  >
                    {a.file_type.startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />}
                    <span className="text-xs truncate max-w-[160px]">{a.file_name}</span>
                    <span className="text-[10px] opacity-70">{formatFileSize(a.file_size_bytes)}</span>
                    <Download size={12} className="ml-auto opacity-60" />
                  </button>
                ))}
              </div>
            )}
            {message.body && <span>{message.body}</span>}
            <div className={cn("flex items-center gap-1 mt-1", mine ? "justify-end" : "justify-start")}>
              <span className={cn("text-[10px]", mine ? "text-white/60" : "text-gray-400")}>
                {fmtTime(message.created_at)}{message.edited_at ? " · edited" : ""}
              </span>
            </div>
          </div>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 relative">
            <button type="button" onClick={() => setEmojiOpen((o) => !o)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
              <Smile size={14} />
            </button>
            <button type="button" onClick={() => setMenuOpen((o) => !o)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
              <MoreHorizontal size={14} />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-full mb-1 right-0 bg-white border border-gray-200 rounded-full shadow-lg px-2 py-1 flex gap-1 z-20">
                {REACTION_EMOJIS.map((e) => (
                  <button key={e} type="button" className="hover:scale-125 transition-transform" onClick={() => { onReact(message, e); setEmojiOpen(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            {menuOpen && (
              <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[150px] text-xs">
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 text-left" onClick={() => { onReply(message); setMenuOpen(false); }}>
                  <Reply size={13} /> Reply
                </button>
                {(mine || canModerate) && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 text-left" onClick={() => { onPin(message, !message.pinned_at); setMenuOpen(false); }}>
                    <Pin size={13} /> {message.pinned_at ? "Unpin" : "Pin"}
                  </button>
                )}
                {mine && message.message_type === "text" && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 text-left" onClick={() => { onEdit(message); setMenuOpen(false); }}>
                    <Pencil size={13} /> Edit
                  </button>
                )}
                {(mine || canModerate) && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-red-50 text-red-600 text-left" onClick={() => { onDelete(message); setMenuOpen(false); }}>
                    <Trash2 size={13} /> Delete
                  </button>
                )}
                {!mine && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 text-left" onClick={() => { onReport(message); setMenuOpen(false); }}>
                    <Flag size={13} /> Report
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {Object.keys(reactionCounts).length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap px-1">
            {Object.entries(reactionCounts).map(([emoji, count]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(message, emoji)}
                className={cn(
                  "text-xs rounded-full px-1.5 py-0.5 border flex items-center gap-0.5",
                  iReacted.has(emoji) ? "bg-[#FBF6E8] border-[#C9A227]" : "bg-white border-gray-200"
                )}
              >
                <span>{emoji}</span><span className="text-[10px] text-gray-500">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
