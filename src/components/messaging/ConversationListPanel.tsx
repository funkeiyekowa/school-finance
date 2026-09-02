"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/messaging/Avatar";
import type { ConversationListItem } from "@/lib/messaging/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Plus, Search, Users, Megaphone, MessageSquare, Settings, ShieldAlert } from "lucide-react";

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  items: ConversationListItem[];
  activeId: string | null;
  onNewMessage: () => void;
  onNewGroup: () => void;
  canCreateGroup: boolean;
  hideOnMobileWhenActive: boolean;
  isOrgAdmin?: boolean;
}

type Filter = "all" | "unread" | "groups" | "announcements";

export function ConversationListPanel({ items, activeId, onNewMessage, onNewGroup, canCreateGroup, hideOnMobileWhenActive, isOrgAdmin }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = items.filter((i) => {
    if (query && !i.display_title.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "unread" && i.unread_count === 0) return false;
    if (filter === "groups" && i.conversation.type === "direct") return false;
    if (filter === "announcements" && i.conversation.type !== "announcement") return false;
    return true;
  });

  return (
    <div className={cn(
      "flex flex-col w-full md:w-[340px] flex-shrink-0 border-r border-gray-200 bg-white h-full",
      hideOnMobileWhenActive && activeId && "hidden md:flex"
    )}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0F2A47]">Messages</h2>
        <div className="flex items-center gap-1">
          {isOrgAdmin && (
            <>
              <Link href="/dashboard/messages/moderation" title="Moderation" className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
                <ShieldAlert size={16} />
              </Link>
              <Link href="/dashboard/messages/settings" title="Settings" className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
                <Settings size={16} />
              </Link>
            </>
          )}
          {canCreateGroup && (
            <button onClick={onNewGroup} title="New group" className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
              <Users size={17} />
            </button>
          )}
          <button onClick={onNewMessage} title="New message" className="p-2 rounded-full hover:bg-gray-100 text-[#0F2A47]">
            <Plus size={18} />
          </button>
        </div>
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:bg-white"
          />
        </div>
      </div>
      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
        {(["all", "unread", "groups", "announcements"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium capitalize whitespace-nowrap",
              filter === f ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10 text-gray-400">
            <MessageSquare size={28} className="mb-2 opacity-40" />
            <p className="text-sm">{query ? "No conversations match your search." : "No conversations yet. Start one!"}</p>
          </div>
        ) : (
          filtered.map((item) => {
            const isActive = item.conversation.id === activeId;
            const isAnnouncement = item.conversation.type === "announcement";
            return (
              <button
                key={item.conversation.id}
                onClick={() => router.push(`/dashboard/messages/${item.conversation.id}`)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 border-b border-gray-50",
                  isActive && "bg-[#FBF6E8]"
                )}
              >
                <div className="relative">
                  <Avatar name={item.display_title} seed={item.avatar_seed} size={44} imageUrl={item.conversation.avatar_url} />
                  {isAnnouncement && (
                    <span className="absolute -bottom-0.5 -right-0.5 bg-[#C9A227] rounded-full p-0.5">
                      <Megaphone size={10} className="text-white" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-sm truncate", item.unread_count > 0 ? "font-bold text-gray-900" : "font-medium text-gray-700")}>
                      {item.display_title}
                    </p>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtWhen(item.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-xs truncate", item.unread_count > 0 ? "text-gray-600 font-medium" : "text-gray-400")}>
                      {item.last_message_preview || item.display_subtitle}
                    </p>
                    {item.unread_count > 0 && (
                      <span className="flex-shrink-0 bg-[#0F2A47] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                        {item.unread_count > 99 ? "99+" : item.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
