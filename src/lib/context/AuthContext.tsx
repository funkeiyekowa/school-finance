"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
  hasFeature: (key: string) => boolean;
  permissions: Record<string, boolean>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  canEdit: false,
  isAdmin: false,
  hasFeature: () => false,
  permissions: {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      setProfile(data as Profile);
      // Load role permissions
      const { data: roleData } = await supabase
        .from("roles")
        .select("permissions")
        .eq("name", (data as Profile).role)
        .single();
      if (roleData?.permissions && typeof roleData.permissions === "object") {
        setPermissions(roleData.permissions as Record<string, boolean>);
      } else if ((data as Profile).role === "admin") {
        setPermissions({
          income: true, expenses: true, students: true, vendors: true,
          reconciliation: true, reports: true, receipts: true, setup: true,
          roles: true, team: true, activity: true, sms_alerts: true,
        });
      }
    }
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    // Get initial user
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      if (u) {
        loadProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const newUser = session?.user ?? null;
        setUser(newUser);
        if (newUser) {
          await loadProfile(newUser.id);
        } else {
          setProfile(null);
          setPermissions({});
        }
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, [supabase, loadProfile]);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setPermissions({});
  }

  const isAdmin = profile?.role === "admin" && (profile?.active ?? false);
  const canEdit = ["admin", "editor", "staff"].includes(profile?.role ?? "") && (profile?.active ?? false);

  function hasFeature(key: string): boolean {
    if (isAdmin) return true;
    return permissions[key] === true;
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signOut, refreshProfile,
      canEdit, isAdmin, hasFeature, permissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
