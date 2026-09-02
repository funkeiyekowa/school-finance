"use client";

import { useParams } from "next/navigation";
import { MessagesShell } from "@/components/messaging/MessagesShell";

export default function MessageThreadPage() {
  const params = useParams<{ conversationId: string }>();
  return <MessagesShell activeConversationId={params.conversationId} />;
}
