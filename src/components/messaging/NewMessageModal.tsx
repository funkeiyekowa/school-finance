"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/messaging/Avatar";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import type { MessageableUser } from "@/lib/messaging/types";
import { Search } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}

export function NewMessageModal({ open, onClose, onStarted }: Props) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_messageable_users", { p_query: query, p_limit: 25 });
      if (!cancelled) {
        if (!error) setResults((data as MessageableUser[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, supabase]);

  async function start(user: MessageableUser) {
    setStarting(user.user_id);
    setError(null);
    const { data, error } = await supabase.rpc("create_direct_conversation", { p_other: user.user_id });
    setStarting(null);
    if (error) { setError(error.message); return; }
    onClose();
    onStarted(data as string);
  }

  return (
    <Modal open={open} onClose={onClose} title="New message" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            autoFocus
            placeholder="Search people you can message…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="max-h-80 overflow-y-auto -mx-1">
          {loading ? (
            <div className="py-6"><LoadingSpinner /></div>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              {query ? "No one found — you can only message people your school allows." : "Start typing a name."}
            </p>
          ) : (
            results.map((u) => (
              <button
                key={u.user_id}
                type="button"
                disabled={starting === u.user_id}
                onClick={() => start(u)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 text-left disabled:opacity-50"
              >
                <Avatar name={u.full_name} seed={u.user_id} size={36} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.full_name}</p>
                  <p className="text-xs text-gray-400 truncate">{u.subtitle}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
