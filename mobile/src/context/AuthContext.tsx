import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { MobileIdentity } from "@/lib/auth-types";
import { restoreIdentity, signInToSchool, signOut as endSession } from "@/lib/auth-service";
import { supabase } from "@/lib/supabase";

type AuthValue = {
  identity: MobileIdentity | null;
  loading: boolean;
  signIn: (input: { slug: string; identifier: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [identity, setIdentity] = useState<MobileIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setIdentity(null);
      setLoading(false);
      return;
    }
    try {
      const restored = await restoreIdentity(session.user.id, session.user.email ?? null);
      if (!restored) await endSession();
      setIdentity(restored);
    } catch {
      await endSession();
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setIdentity(null);
    });
    return () => subscription.unsubscribe();
  }, [hydrate]);

  const value = useMemo<AuthValue>(() => ({
    identity,
    loading,
    signIn: async (input) => {
      const next = await signInToSchool(input);
      setIdentity(next);
    },
    signOut: async () => {
      await endSession();
      setIdentity(null);
    }
  }), [identity, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
