import type { LibraryEntry, LibraryStatus, Progress, SourceKind, Work } from "@hao/domain";
import type { Database } from "./index.js";

type WorkRow = {
  id: string;
  kind: Work["kind"];
  title: string;
  alternate_titles: string[];
  synopsis: string;
  cover_url: string | null;
  banner_url: string | null;
  release_year: number | null;
  release_status: string | null;
  genres: string[];
  maturity_rating: string | null;
  average_score: number | string | null;
  source_kind: SourceKind | null;
  external_id: string | null;
};

type LibraryRow = WorkRow & {
  library_id: string;
  library_status: LibraryStatus;
  favorite: boolean;
  rating: number | string | null;
  notes: string;
  library_updated_at: Date | string;
  progress_release_item_id: string | null;
  completed_units: number | string | null;
  position_seconds: number | string | null;
  position_percent: number | string | null;
  progress_updated_at: Date | string | null;
};

const numberOrNull = (value: number | string | null): number | null => (value === null ? null : Number(value));
const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function mapWork(row: WorkRow): Work {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    alternateTitles: row.alternate_titles ?? [],
    synopsis: row.synopsis ?? "",
    coverUrl: row.cover_url,
    bannerUrl: row.banner_url,
    year: row.release_year,
    status: row.release_status,
    genres: row.genres ?? [],
    maturityRating: row.maturity_rating,
    averageScore: numberOrNull(row.average_score),
    source: {
      kind: row.source_kind ?? "ANILIST",
      externalId: row.external_id ?? row.id
    }
  };
}

const workSelect = `
  w.id, w.kind, w.title, w.alternate_titles, w.synopsis, w.cover_url, w.banner_url,
  w.release_year, w.release_status, w.genres, w.maturity_rating, w.average_score,
  sr.source_kind, sr.external_id
`;

export class HaoRepository {
  constructor(private readonly sql: Database) {}

  async health(): Promise<boolean> {
    const [row] = await this.sql<{ ok: number }[]>`select 1 as ok`;
    return row?.ok === 1;
  }

  async ensureProfile(userId: string, displayName: string, role: "member" | "admin" = "member"): Promise<void> {
    await this.sql`
      insert into profiles (id, display_name, role)
      values (${userId}, ${displayName}, ${role})
      on conflict (id) do update set display_name = excluded.display_name
    `;
  }

  async getProfile(userId: string): Promise<{
    id: string;
    displayName: string;
    role: "member" | "admin";
    suspendedAt: string | null;
  } | null> {
    const [row] = await this.sql<
      {
        id: string;
        display_name: string;
        role: "member" | "admin";
        suspended_at: Date | null;
      }[]
    >`
      select id, display_name, role, suspended_at from profiles where id = ${userId}
    `;
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          role: row.role,
          suspendedAt: row.suspended_at?.toISOString() ?? null
        }
      : null;
  }

  async acceptInvitation(userId: string, email: string): Promise<void> {
    const rows = await this.sql`
      update invitations set accepted_at=coalesce(accepted_at,now())
      where lower(email::text)=lower(${email}) and accepted_at is null and expires_at > now()
      returning id
    `;
    if (rows.length) await this.audit(userId, "invitation.accept", "profile", userId);
  }

  async upsertWork(work: Work): Promise<Work> {
    return this.sql.begin(async (tx) => {
      const existing = await tx<{ id: string }[]>`
        select work_id as id from source_records
        where source_kind = ${work.source.kind}::source_kind and provider_id = ${work.source.kind.toLowerCase()} and external_id = ${work.source.externalId}
        limit 1
      `;
      let workId = existing[0]?.id;
      if (workId) {
        await tx`
          update works set title=${work.title}, alternate_titles=${work.alternateTitles}, synopsis=${work.synopsis}, cover_url=${work.coverUrl},
            banner_url=${work.bannerUrl}, release_year=${work.year}, release_status=${work.status}, genres=${work.genres},
            maturity_rating=${work.maturityRating}, average_score=${work.averageScore}, updated_at=now()
          where id=${workId}
        `;
      } else {
        const [created] = await tx<{ id: string }[]>`
          insert into works (kind,title,alternate_titles,synopsis,cover_url,banner_url,release_year,release_status,genres,maturity_rating,average_score)
          values (${work.kind}::media_kind,${work.title},${work.alternateTitles},${work.synopsis},${work.coverUrl},${work.bannerUrl},${work.year},${work.status},${work.genres},${work.maturityRating},${work.averageScore})
          returning id
        `;
        if (!created) throw new Error("Failed to create work");
        workId = created.id;
        await tx`
          insert into source_records (work_id,source_kind,provider_id,external_id,provenance)
          values (${workId},${work.source.kind}::source_kind,${work.source.kind.toLowerCase()},${work.source.externalId},${tx.json({ importedAt: new Date().toISOString() })})
        `;
      }
      return { ...work, id: workId };
    });
  }

  async getWork(id: string): Promise<Work | null> {
    const rows = await this.sql.unsafe<WorkRow[]>(
      `
      select ${workSelect} from works w
      left join lateral (select source_kind, external_id from source_records where work_id=w.id order by last_seen_at desc limit 1) sr on true
      where w.id=$1
    `,
      [id]
    );
    return rows[0] ? mapWork(rows[0]) : null;
  }

  async listLibrary(userId: string): Promise<LibraryEntry[]> {
    const rows = await this.sql.unsafe<LibraryRow[]>(
      `
      select ${workSelect}, le.id as library_id, le.status as library_status, le.favorite, le.rating, le.notes,
        le.updated_at as library_updated_at, p.release_item_id as progress_release_item_id, p.completed_units,
        p.position_seconds, p.position_percent, p.updated_at as progress_updated_at
      from library_entries le join works w on w.id=le.work_id
      left join lateral (select source_kind, external_id from source_records where work_id=w.id order by last_seen_at desc limit 1) sr on true
      left join progress p on p.user_id=le.user_id and p.work_id=le.work_id
      where le.user_id=$1 order by le.updated_at desc
    `,
      [userId]
    );
    return rows.map((row) => ({
      id: row.library_id,
      work: mapWork(row),
      status: row.library_status,
      favorite: row.favorite,
      rating: numberOrNull(row.rating),
      notes: row.notes,
      updatedAt: iso(row.library_updated_at),
      progress: row.progress_updated_at
        ? {
            workId: row.id,
            releaseItemId: row.progress_release_item_id,
            completedUnits: Number(row.completed_units ?? 0),
            positionSeconds: numberOrNull(row.position_seconds),
            positionPercent: numberOrNull(row.position_percent),
            updatedAt: iso(row.progress_updated_at)
          }
        : null
    }));
  }

  async upsertLibrary(
    userId: string,
    input: {
      workId: string;
      status: LibraryStatus;
      favorite: boolean;
      rating: number | null;
      notes: string;
    }
  ): Promise<LibraryEntry | null> {
    await this.sql`
      insert into library_entries (user_id,work_id,status,favorite,rating,notes)
      values (${userId},${input.workId},${input.status}::library_status,${input.favorite},${input.rating},${input.notes})
      on conflict (user_id,work_id) do update set status=excluded.status,favorite=excluded.favorite,rating=excluded.rating,notes=excluded.notes,updated_at=now()
    `;
    await this.audit(userId, "library.upsert", "work", input.workId);
    return (await this.listLibrary(userId)).find((entry) => entry.work.id === input.workId) ?? null;
  }

  async listCustomLists(userId: string): Promise<Array<{ id: string; name: string; description: string; workIds: string[] }>> {
    const rows = await this.sql<{ id: string; name: string; description: string; work_ids: string[] | null }[]>`
      select l.id,l.name,l.description,array_remove(array_agg(i.work_id order by i.position),null)::text[] work_ids
      from custom_lists l left join custom_list_items i on i.list_id=l.id
      where l.user_id=${userId} group by l.id order by l.created_at
    `;
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, workIds: row.work_ids ?? [] }));
  }

  async createCustomList(userId: string, name: string): Promise<{ id: string; name: string; description: string; workIds: string[] }> {
    const [row] = await this.sql<{ id: string; name: string; description: string }[]>`insert into custom_lists(user_id,name) values(${userId},${name}) returning id,name,description`;
    if (!row) throw new Error("Custom list could not be created");
    await this.audit(userId, "list.create", "custom_list", row.id, { name });
    return { ...row, workIds: [] };
  }

  async setCustomListItem(userId: string, listId: string, workId: string, included: boolean): Promise<boolean> {
    if (included) await this.sql`insert into custom_list_items(list_id,work_id,position) select l.id,${workId},coalesce((select max(position)+1 from custom_list_items where list_id=l.id),0) from custom_lists l where l.id=${listId} and l.user_id=${userId} on conflict do nothing`;
    else await this.sql`delete from custom_list_items i using custom_lists l where i.list_id=l.id and l.id=${listId} and l.user_id=${userId} and i.work_id=${workId}`;
    await this.audit(userId, included ? "list.item_add" : "list.item_remove", "custom_list", listId, { workId });
    return true;
  }

  async updateProgress(
    userId: string,
    input: {
      workId: string;
      releaseItemId: string | null;
      completedUnits: number;
      positionSeconds: number | null;
      positionPercent: number | null;
    }
  ): Promise<Progress> {
    const [row] = await this.sql<{ updated_at: Date }[]>`
      insert into progress (user_id,work_id,release_item_id,completed_units,position_seconds,position_percent)
      values (${userId},${input.workId},${input.releaseItemId},${input.completedUnits},${input.positionSeconds},${input.positionPercent})
      on conflict (user_id,work_id) do update set release_item_id=excluded.release_item_id,completed_units=excluded.completed_units,
        position_seconds=excluded.position_seconds,position_percent=excluded.position_percent,updated_at=now()
      returning updated_at
    `;
    await this.sql`update library_entries set updated_at=now() where user_id=${userId} and work_id=${input.workId}`;
    return {
      ...input,
      updatedAt: row?.updated_at.toISOString() ?? new Date().toISOString()
    };
  }

  async listConnections(userId: string): Promise<
    Array<{
      id: string;
      providerType: string;
      displayName: string;
      endpoint: string | null;
      health: string;
      lastCheckedAt: string | null;
    }>
  > {
    const rows = await this.sql<
      {
        id: string;
        provider_type: string;
        display_name: string;
        endpoint: string | null;
        health: string;
        last_checked_at: Date | null;
      }[]
    >`
      select id,provider_type,display_name,endpoint,health,last_checked_at from provider_connections where user_id=${userId} order by created_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      providerType: row.provider_type,
      displayName: row.display_name,
      endpoint: row.endpoint,
      health: row.health,
      lastCheckedAt: row.last_checked_at?.toISOString() ?? null
    }));
  }

  async listBridgeDevices(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      endpoint: string | null;
      lastSeenAt: string | null;
      revokedAt: string | null;
      scope: "personal" | "beta";
      sharedBeta: boolean;
    }>
  > {
    const rows = await this.sql<
      {
        id: string;
        name: string;
        endpoint: string | null;
        last_seen_at: Date | null;
        revoked_at: Date | null;
        user_id: string;
        shared_beta: boolean;
      }[]
    >`
      select id,name,endpoint,last_seen_at,revoked_at,user_id,shared_beta
      from bridge_devices
      where user_id=${userId} or (shared_beta=true and revoked_at is null)
      order by (user_id=${userId}) desc, shared_beta desc, created_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null,
      scope: row.user_id === userId ? "personal" : "beta",
      sharedBeta: row.shared_beta
    }));
  }

  async setSharedBetaBridge(actorId: string, bridgeId: string | null): Promise<string | null> {
    const selected = await this.sql.begin(async (tx) => {
      await tx`update bridge_devices set shared_beta=false,shared_by=null,shared_at=null where shared_beta=true`;
      if (!bridgeId) return null;
      const [row] = await tx<{ id: string }[]>`
        update bridge_devices set shared_beta=true,shared_by=${actorId},shared_at=now()
        where id=${bridgeId} and user_id=${actorId} and revoked_at is null and endpoint is not null
        returning id
      `;
      if (!row) throw new Error("Active personal Bridge not found");
      return row.id;
    });
    await this.audit(actorId, selected ? "bridge.share_beta" : "bridge.unshare_beta", "bridge_device", selected ?? bridgeId, {});
    return selected;
  }

  async createBridgePairingCode(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from bridge_pairing_codes where expires_at < now() - interval '1 day' or consumed_at is not null`;
      await tx`
        insert into bridge_pairing_codes (code_hash,user_id,expires_at)
        values (${codeHash},${userId},${expiresAt})
      `;
    });
  }

  async consumeBridgePairingCode(userId: string, codeHash: string): Promise<boolean> {
    const rows = await this.sql`
      update bridge_pairing_codes set consumed_at=now()
      where code_hash=${codeHash} and user_id=${userId} and consumed_at is null and expires_at > now()
      returning code_hash
    `;
    return rows.length === 1;
  }

  async upsertBridgeDevice(userId: string, input: { id: string; name: string; publicKey: string; endpoint: string }): Promise<void> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into bridge_devices (id,user_id,name,public_key,endpoint,last_seen_at)
      values (${input.id},${userId},${input.name},${input.publicKey},${input.endpoint},now())
      on conflict (id) do update set name=excluded.name,public_key=excluded.public_key,endpoint=excluded.endpoint,last_seen_at=now(),revoked_at=null
      where bridge_devices.user_id=${userId}
      returning id
    `;
    if (!row) throw new Error("Bridge device belongs to another account");
    await this.audit(userId, "bridge.pair", "bridge_device", input.id, {
      endpoint: input.endpoint
    });
  }

  async listExtensionRepositories(userId: string): Promise<
    Array<{
      id: string;
      bridgeId: string;
      mediaKind: "ANIME" | "MANGA";
      url: string;
      name: string;
      signerFingerprint: string | null;
      acknowledgedAt: string | null;
      enabled: boolean;
      scope: "personal" | "beta";
    }>
  > {
    const rows = await this.sql<
      {
        id: string;
        bridge_id: string;
        media_kind: "ANIME" | "MANGA";
        url: string;
        name: string;
        signer_fingerprint: string | null;
        acknowledged_at: Date | null;
        enabled: boolean;
        user_id: string;
      }[]
    >`
      select r.id,r.bridge_id,r.media_kind,r.url,r.name,r.signer_fingerprint,r.acknowledged_at,r.enabled,b.user_id
      from repositories r join bridge_devices b on b.id=r.bridge_id
      where (b.user_id=${userId} or b.shared_beta=true) and b.revoked_at is null order by (b.user_id=${userId}) desc,r.name
    `;
    return rows.map((row) => ({
      id: row.id,
      bridgeId: row.bridge_id,
      mediaKind: row.media_kind,
      url: row.url,
      name: row.name,
      signerFingerprint: row.signer_fingerprint,
      acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
      enabled: row.enabled,
      scope: row.user_id === userId ? "personal" : "beta"
    }));
  }

  async upsertExtensionRepository(
    userId: string,
    input: {
      bridgeId: string;
      mediaKind: "ANIME" | "MANGA";
      url: string;
      name: string;
    }
  ): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into repositories (bridge_id,media_kind,url,name,acknowledged_at,enabled)
      select ${input.bridgeId},${input.mediaKind},${input.url},${input.name},now(),true
      where exists (select 1 from bridge_devices where id=${input.bridgeId} and user_id=${userId} and revoked_at is null)
      on conflict (bridge_id,url) do update set media_kind=excluded.media_kind,name=excluded.name,acknowledged_at=now(),enabled=true
      returning id
    `;
    if (!row) throw new Error("Bridge device not found");
    await this.audit(userId, "repository.enable", "repository", row.id, {
      url: input.url,
      mediaKind: input.mediaKind
    });
    return row.id;
  }

  async createConnection(
    userId: string,
    input: {
      providerType: string;
      displayName: string;
      endpoint: string | null;
      encryptedCredentials: Uint8Array | null;
      health: string;
    }
  ): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into provider_connections (user_id,provider_type,display_name,endpoint,encrypted_credentials,health,last_checked_at)
      values (${userId},${input.providerType},${input.displayName},${input.endpoint},${input.encryptedCredentials},${input.health},now()) returning id
    `;
    if (!row) throw new Error("Failed to create provider connection");
    await this.audit(userId, "provider.create", "provider_connection", row.id, {
      providerType: input.providerType
    });
    return row.id;
  }

  async createInvitation(input: { email: string; invitedBy: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string; email: string; expiresAt: string }> {
    const [row] = await this.sql<{ id: string; email: string; expires_at: Date }[]>`
      insert into invitations (email,token_hash,invited_by,expires_at) values (${input.email},${input.tokenHash},${input.invitedBy},${input.expiresAt})
      returning id,email,expires_at
    `;
    if (!row) throw new Error("Failed to create invitation");
    await this.audit(input.invitedBy, "invitation.create", "invitation", row.id, { email: input.email });
    return {
      id: row.id,
      email: row.email,
      expiresAt: row.expires_at.toISOString()
    };
  }

  async adminOverview(): Promise<{
    users: number;
    activeBridges: number;
    pendingJobs: number;
    invitations: unknown[];
    audit: unknown[];
  }> {
    // Vercel deliberately uses a one-connection Postgres pool. Keep these
    // lightweight admin reads sequential so concurrent queries cannot pin a
    // cold serverless instance behind the same pooled connection.
    const counts = await this.sql<{ users: number; active_bridges: number; pending_jobs: number }[]>`
      select (select count(*)::int from profiles where suspended_at is null) users,
        (select count(*)::int from bridge_devices where revoked_at is null and endpoint is not null) active_bridges,
        (select count(*)::int from epub_assets where processing_status='pending') pending_jobs
    `;
    const invitations = await this.sql`select id,email,expires_at,accepted_at,created_at from invitations order by created_at desc limit 50`;
    const audit = await this.sql`select id,action,subject_type,subject_id,metadata,created_at from audit_events order by created_at desc limit 50`;
    return {
      users: counts[0]?.users ?? 0,
      activeBridges: counts[0]?.active_bridges ?? 0,
      pendingJobs: counts[0]?.pending_jobs ?? 0,
      invitations,
      audit
    };
  }

  async createEpubAsset(input: { id: string; userId: string; workId: string; storageKey: string; originalName: string; byteSize: number; sha256: string; status: string; manifest: unknown }): Promise<void> {
    await this.sql`
      insert into epub_assets (id,user_id,work_id,storage_key,original_name,byte_size,sha256,processing_status,manifest)
      values (${input.id},${input.userId},${input.workId},${input.storageKey},${input.originalName},${input.byteSize},${input.sha256},${input.status},${this.sql.json(input.manifest as never)})
    `;
  }

  async audit(actorId: string | null, action: string, subjectType: string, subjectId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.sql`
      insert into audit_events (actor_id,action,subject_type,subject_id,metadata)
      values (${actorId},${action},${subjectType},${subjectId},${this.sql.json(metadata as never)})
    `;
  }
}
