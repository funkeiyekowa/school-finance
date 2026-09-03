"use client";

import { MessagesShell } from "@/components/messaging/MessagesShell";

export default function MessagesPage() {
  return (
    <div className="h-full">
      <MessagesShell activeConversationId={null} />
    </div>
  );
}
