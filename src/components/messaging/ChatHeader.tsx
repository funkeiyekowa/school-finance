"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/messaging/Avatar";
import { AiAssistButton } from "@/components/ai/AiAssistButton";
import type { Conversation, ConversationType } from "@/lib/messaging/types";
import { ArrowLeft, Info, Sparkles, Megaphone } from "lucide-react";

interface Props {
  title: string;
  subtitle: string;
  avatarSeed: string;
  avatarUrl: string | null;
  type: ConversationType;
  typingLabel: string | null;
  onOpenInfo: () => void;
  showSummarize: boolean;
  onSummary: (text: string) => void;
  threadTextForSummary: string;
}

export function ChatHeader({
  title, subtitle, avatarSeed, avatarUrl, type, typingLabel, onOpenInfo, showSummarize, onSummary, threadTextForSummary,
}: Props) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
      <button onClick={() => router.push("/dashboard/messages")} className="md:hidden p-1 -ml-1 text-gray-500">
        <ArrowLeft size={20} />
      </button>
      <div className="relative">
        <Avatar name={title} seed={avatarSeed} size={38} imageUrl={avatarUrl} />
        {type === "announcement" && (
          <span className="absolute -bottom-0.5 -right-0.5 bg-[#C9A227] rounded-full p-0.5">
            <Megaphone size={9} className="text-white" />
          </span>
        )}
      </div>
      <button onClick={onOpenInfo} className="min-w-0 flex-1 text-left">
        <p className="text-sm font-semibold text-gray-800 truncate">{title}</p>
        <p className="text-xs text-gray-400 truncate">{typingLabel || subtitle}</p>
      </button>
      {showSummarize && (
        <AiAssistButton
          kinds={["message_thread_summary"]}
          currentValue={threadTextForSummary}
          onApply={onSummary}
          source="messages.summarize"
          label="Summarize"
          compact
        />
      )}
      {type !== "direct" && (
        <button onClick={onOpenInfo} className="p-2 rounded-full hover:bg-gray-100 text-gray-400">
          <Info size={18} />
        </button>
      )}
    </div>
  );
}
