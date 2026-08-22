"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Organization, OrgMembership } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
  isDeveloper: boolean;
  /** Platform-level super admin (can manage all orgs). */
  isSuperAdmin: boolean;
  hasFeature: (key: string) => boolean;
  /** Check if a module is enabled for the current organization. */
  hasModule: (moduleKey: string) => boolean;
  permissions: Record<string, boolean>;
  /** Current organization ID (from the user's default membership). */
  orgId: string | null;
  /** Current organization object. */
  org: Organization | null;
  /** Current user's membership in the org. */
  membership: OrgMembership | null;
  /** Module keys enabled for the current org. */
  enabledModules: string[];
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  canEdit: false,
  isAdmin: false,
  isDeveloper: false,
  isSuperAdmin: false,
  hasFeature: () => false,
  hasModule: () => true,
  permissions: {},
  orgId: null,
  org: null,
  membership: null,
  enabledModules: [],
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [orgId, setOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrgMembership | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);

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

      // Load organization membership
      await loadOrganization(userId);
    }
  }, [supabase]);

  const loadOrganization = useCallback(async (userId: string) => {
    // Find the user's default membership
    const { data: mem } = await supabase
      .from("org_memberships")
      .select("*")
      .eq("user_id", userId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();

    if (mem) {
      setMembership(mem as OrgMembership);
      setOrgId(mem.organization_id);

      // Load the organization
      const { data: orgData } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", mem.organization_id)
        .single();
      if (orgData) setOrg(orgData as Organization);

      // Load enabled modules for this org
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("module_key")
        .eq("organization_id", mem.organization_id)
        .eq("status", "active");
      setEnabledModules((subs ?? []).map((s: { module_key: string }) => s.module_key));
    } else {
      // Fallback: try any membership for this user
      const { data: anyMem } = await supabase
        .from("org_memberships")
        .select("*")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (anyMem) {
        setMembership(anyMem as OrgMembership);
        setOrgId(anyMem.organization_id);
        const { data: orgData } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", anyMem.organization_id)
          .single();
        if (orgData) setOrg(orgData as Organization);
        const { data: subs } = await supabase
          .from("subscriptions")
          .select("module_key")
          .eq("organization_id", anyMem.organization_id)
          .eq("status", "active");
        setEnabledModules((subs ?? []).map((s: { module_key: string }) => s.module_key));
      } else {
        // No membership yet (migration not run) — allow full access for backward compatibility
        setOrgId(null);
        setOrg(null);
        setMembership(null);
        setEnabledModules([]);
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
          setOrg(null);
          setOrgId(null);
          setMembership(null);
          setEnabledModules([]);
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
    setOrg(null);
    setOrgId(null);
    setMembership(null);
    setEnabledModules([]);
  }

  const isAdmin = (profile?.role === "admin" || profile?.role === "developer") && (profile?.active ?? false);
  const isDeveloper = profile?.role === "developer" && (profile?.active ?? false);
  const isSuperAdmin = membership?.role === "super_admin" || isDeveloper;
  const canEdit = ["admin", "editor", "staff", "developer"].includes(profile?.role ?? "") && (profile?.active ?? false);

  function hasFeature(key: string): boolean {
    if (isAdmin || isDeveloper) return true;
    return permissions[key] === true;
  }

  /**
   * Check if a module is enabled for the current organization.
   * If no org context exists (migration not run), returns true for backward compatibility.
   */
  function hasModule(moduleKey: string): boolean {
    if (!orgId) return true; // No org loaded — pre-migration, allow everything
    if (enabledModules.length === 0) return true; // No subscriptions loaded yet
    return enabledModules.includes(moduleKey);
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signOut, refreshProfile,
      canEdit, isAdmin, isDeveloper, isSuperAdmin,
      hasFeature, hasModule, permissions,
      orgId, org, membership, enabledModules,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
