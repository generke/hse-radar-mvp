-- Evaluate the authenticated user once per statement instead of once per row.
-- This preserves the existing authorization predicates while avoiding the
-- auth_rls_initplan performance penalty reported by Supabase Advisor.

alter policy "membership read" on public.memberships
  using (user_id = (select auth.uid()) or public.is_org_member(organization_id) or public.is_platform_admin());

alter policy "membership admin delete" on public.memberships
  using (public.can_admin_org(organization_id) and user_id <> (select auth.uid()));

alter policy "platform admin self read" on public.platform_admins
  using (user_id = (select auth.uid()));

alter policy "profile self" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "profile org read" on public.profiles
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );

alter policy "payment org submit" on public.payment_requests
  with check (
    public.is_org_member(organization_id)
    and submitted_by = (select auth.uid())
    and status = 'pending'
  );

alter policy "notification own read" on public.user_notifications
  using (user_id = (select auth.uid()));

alter policy "notification own update" on public.user_notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "section insert" on public.learning_attempts
  with check (
    public.has_section_access(organization_id, 'learning')
    and (taken_by = (select auth.uid()) or public.can_manage_section(organization_id, 'learning'))
  );

alter policy "section update" on public.tasks
  using (
    public.has_section_access(organization_id, 'tasks')
    and (
      public.can_manage_section(organization_id, 'tasks')
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  )
  with check (
    public.has_section_access(organization_id, 'tasks')
    and (
      public.can_manage_section(organization_id, 'tasks')
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  );

alter policy "section delete" on public.tasks
  using (
    public.has_section_access(organization_id, 'tasks')
    and (
      public.can_manage_section(organization_id, 'tasks')
      or assignee_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  );

alter policy "own pairing read" on public.vision_telegram_pairings
  using (user_id = (select auth.uid()));

alter policy "own pairing insert" on public.vision_telegram_pairings
  with check (
    user_id = (select auth.uid())
    and public.has_section_access(organization_id, 'vision')
  );
