"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Profile, Organization, OrgMembership } from "@/lib/types";

/** A row from the my_organizations() RPC — an org the user can switch into. */
export interface SwitchableOrg {
  organization_id: string;
  name: string;
  slug: string;
  plan: string | null;
  status: string | null;
  logo_url: string | null;
  membership_role: string;
  is_default: boolean;
  /** True when the user is not a real member but can enter as platform admin. */
  is_support_access: boolean;
}

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
  /** Owner or admin of the currently active organization. */
  isOrgAdmin: boolean;
  hasFeature: (key: string) => boolean;
  /** Check if a module is enabled for the current organization. */
  hasModule: (moduleKey: string) => boolean;
  permissions: Record<string, boolean>;
  /** Current organization ID (from the user's active membership). */
  orgId: string | null;
  /** Current organization object. */
  org: Organization | null;
  /** Current user's membership in the active org. */
  membership: OrgMembership | null;
  /** Module keys enabled for the current org. */
  enabledModules: string[];
  /** Every org this user can operate as. */
  availableOrgs: SwitchableOrg[];
  /** Switch the active tenant. Moves the RLS pointer server-side. */
  switchOrg: (orgId: string) => Promise<{ ok: boolean; error?: string }>;
  switchingOrg: boolean;
  /** True when the active org was entered via platform-admin support access. */
  isSupportSession: boolean;
}

const FULL_PERMISSIONS: Record<string, boolean> = {
  income: true, expenses: true, students: true, student_finance: true,
  vendors: true, reconciliation: true, reports: true, receipts: true,
  setup: true, roles: true, team: true, activity: true, sms_alerts: true,
  website: true, analytics: true,
};

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
  isOrgAdmin: false,
  hasFeature: () => false,
  hasModule: () => true,
  permissions: {},
  orgId: null,
  org: null,
  membership: null,
  enabledModules: [],
  availableOrgs: [],
  switchOrg: async () => ({ ok: false, error: "Not ready" }),
  switchingOrg: false,
  isSupportSession: false,
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
  const [availableOrgs, setAvailableOrgs] = useState<SwitchableOrg[]>([]);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [isSupportSession, setIsSupportSession] = useState(false);

  /** Guards against overlapping loads racing each other into state. */
  const loadToken = useRef(0);
  /** The user id we have already fully loaded, so repeated SIGNED_IN
   *  events (which fire on tab refocus) don't re-run the whole
   *  profile+org+permissions bundle needlessly. */
  const loadedUserId = useRef<string | null>(null);

  const loadOrganization = useCallback(async (userId: string) => {
    // Fire org list AND the active membership in parallel — they don't
    // depend on each other. The RPC + membership were sequential; that's
    // 300-500 ms cut on every dashboard mount.
    let orgs: SwitchableOrg[] = [];
    const [orgListRes, memRes] = await Promise.all([
      supabase.rpc("my_organizations"),
      supabase
        .from("org_memberships")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!orgListRes.error && Array.isArray(orgListRes.data)) {
      orgs = orgListRes.data as SwitchableOrg[];
    } else {
      // Fallback path — the my_organizations RPC isn't installed. One
      // extra query, but only on legacy deployments.
      const { data: fallback } = await supabase
        .from("org_memberships")
        .select("organization_id, role, is_default, organizations(name, slug, plan, status, logo_url)")
        .eq("user_id", userId)
        .eq("active", true);
      orgs = (fallback ?? []).map((row) => {
        const o = (row as Record<string, unknown>).organizations as Record<string, unknown> | null;
        return {
          organization_id: String((row as Record<string, unknown>).organization_id),
          name: String(o?.name ?? "Organization"),
          slug: String(o?.slug ?? ""),
          plan: (o?.plan as string) ?? null,
          status: (o?.status as string) ?? null,
          logo_url: (o?.logo_url as string) ?? null,
          membership_role: String((row as Record<string, unknown>).role ?? "staff"),
          is_default: Boolean((row as Record<string, unknown>).is_default),
          is_support_access: false,
        };
      });
    }
    setAvailableOrgs(orgs);

    const mem = memRes.data;

    if (!mem) {
      // No membership at all — pre-migration install or an unassigned
      // signup. Leave org context empty; hasModule stays permissive so
      // existing single-school deployments keep working.
      setMembership(null);
      setOrgId(null);
      setOrg(null);
      setEnabledModules([]);
      setIsSupportSession(false);
      return null;
    }

    const activeOrgId = (mem as OrgMembership).organization_id;
    setMembership(mem as OrgMembership);
    setOrgId(activeOrgId);
    setIsSupportSession(
      orgs.find((o) => o.organization_id === activeOrgId)?.is_support_access ?? false
    );

    const [{ data: orgData }, { data: subs }] = await Promise.all([
      supabase.from("organizations").select("*").eq("id", activeOrgId).single(),
      supabase
        .from("subscriptions")
        .select("module_key")
        .eq("organization_id", activeOrgId)
        .eq("status", "active"),
    ]);

    if (orgData) setOrg(orgData as Organization);
    setEnabledModules((subs ?? []).map((s: { module_key: string }) => s.module_key));

    return activeOrgId;
  }, [supabase]);

  const loadProfile = useCallback(async (userId: string) => {
    const token = ++loadToken.current;

    // Kick off profile, org, and permissions in parallel — none of them
    // depend on each other for the initial read, so waiting sequentially
    // was pure latency. Total wall-clock drops from ~5 round-trips to 1.
    const [profileRes, _org, permsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      loadOrganization(userId),
      supabase.rpc("my_effective_permissions"),
    ]);

    if (token !== loadToken.current) return; // superseded
    if (!profileRes.data) return;

    const prof = profileRes.data as Profile;
    setProfile(prof);

    const perms = permsRes.data;
    const permErr = permsRes.error;

    if (token !== loadToken.current) return;

    if (!permErr && perms && typeof perms === "object") {
      setPermissions(perms as Record<string, boolean>);
    } else {
      // Fallback for installs where the RPC is not present yet.
      const { data: roleData } = await supabase
        .from("roles")
        .select("permissions")
        .eq("name", prof.role)
        .limit(1)
        .maybeSingle();
      if (roleData?.permissions && typeof roleData.permissions === "object") {
        setPermissions(roleData.permissions as Record<string, boolean>);
      } else if (prof.role === "admin" || prof.role === "developer") {
        setPermissions(FULL_PERMISSIONS);
      } else {
        setPermissions({});
      }
    }
  }, [supabase, loadOrganization]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const clearSession = useCallback(() => {
    setProfile(null);
    setPermissions({});
    setOrg(null);
    setOrgId(null);
    setMembership(null);
    setEnabledModules([]);
    setAvailableOrgs([]);
    setIsSupportSession(false);
  }, []);

  /**
   * Switch the active tenant.
   *
   * This is a server-side operation on purpose: RLS resolves the tenant
   * through current_user_org_id(), which reads org_memberships.is_default.
   * Changing it in React state alone would show a different org name while
   * still querying the previous tenant's rows.
   */
  const switchOrg = useCallback(async (targetOrgId: string) => {
    if (!user) return { ok: false, error: "Not signed in" };
    if (targetOrgId === orgId) return { ok: true };

    setSwitchingOrg(true);
    try {
      const { data, error } = await supabase.rpc("switch_active_org", { p_org: targetOrgId });
      if (error) {
        return { ok: false, error: error.message };
      }
      const result = data as { ok?: boolean } | null;
      if (result && result.ok === false) {
        return { ok: false, error: "Switch was rejected" };
      }

      // Reload everything that depends on tenant context.
      await loadProfile(user.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Switch failed" };
    } finally {
      setSwitchingOrg(false);
    }
  }, [supabase, user, orgId, loadProfile]);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled) return;
      setUser(u);
      if (u) {
        loadedUserId.current = u.id;
        loadProfile(u.id).finally(() => { if (!cancelled) setLoading(false); });
      } else {
        loadedUserId.current = null;
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // TOKEN_REFRESHED fires often and carries no new profile data.
        if (event === "TOKEN_REFRESHED") return;

        const newUser = session?.user ?? null;

        if (newUser) {
          // If this is the same user we've already loaded (e.g. a
          // SIGNED_IN re-emitted on tab refocus or an INITIAL_SESSION
          // that follows the getUser() call above), don't re-run the
          // whole profile+org+permissions bundle — just make sure the
          // user object is current. This is the difference between a
          // snappy tab switch and a 3-query stall on every refocus.
          if (loadedUserId.current === newUser.id) {
            setUser(newUser);
            setLoading(false);
            return;
          }
          loadedUserId.current = newUser.id;
          setUser(newUser);
          await loadProfile(newUser.id);
        } else {
          loadedUserId.current = null;
          setUser(null);
          clearSession();
        }
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, loadProfile, clearSession]);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    clearSession();
  }

  const isDeveloper = profile?.role === "developer" && (profile?.active ?? false);
  const isSuperAdmin = membership?.role === "super_admin" || isDeveloper;
  const isOrgAdmin =
    isSuperAdmin || ["owner", "admin"].includes(membership?.role ?? "");
  // Legacy profile-role admin check, kept so pre-migration installs work.
  const isAdmin =
    isOrgAdmin ||
    ((profile?.role === "admin" || profile?.role === "developer") && (profile?.active ?? false));
  const canEdit =
    isAdmin ||
    ["editor", "staff", "bursar", "accountant"].includes(membership?.role ?? "") ||
    (["admin", "editor", "staff", "developer"].includes(profile?.role ?? "") && (profile?.active ?? false));

  function hasFeature(key: string): boolean {
    if (isAdmin) return true;
    return permissions[key] === true;
  }

  /**
   * Is a module enabled for the active organization?
   *
   * Permissive only when there is genuinely no tenant context (a
   * pre-migration single-school install). Once an org is loaded, an
   * empty subscription list means no paid modules, not "allow all".
   */
  function hasModule(moduleKey: string): boolean {
    if (!orgId) return true;
    return enabledModules.includes(moduleKey);
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signOut, refreshProfile,
      canEdit, isAdmin, isDeveloper, isSuperAdmin, isOrgAdmin,
      hasFeature, hasModule, permissions,
      orgId, org, membership, enabledModules,
      availableOrgs, switchOrg, switchingOrg, isSupportSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
