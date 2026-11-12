import { createHash, createHmac, randomBytes } from "node:crypto";
import { Pool } from "pg";

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export interface ClientSite {
  id: number;
  callbackCode: string;
  name: string;
}

export interface ClientMember {
  id: number;
  siteId: number;
  email: string;
  name: string;
  googleId: string;
}

export interface SiteMemberRepository {
  findSiteByCallbackCode(callbackCode: string): Promise<ClientSite | null>;
  provisionMember(siteId: number, profile: GoogleProfile): Promise<ClientMember>;
  revokeMemberGrant(grant: string, siteId: number, memberId: number): Promise<void>;
  registerOAuthClient(name: string, redirectUris: string[]): Promise<string>;
  findOAuthClient(id: string): Promise<{name: string; redirectUris: string[]} | null>;
  storeOAuthCode(payload: string, ttlSeconds?: number): Promise<string>;
  consumeOAuthCode(code: string): Promise<string | null>;
  issueMemberGrant(member: ClientMember): Promise<string>;
  issueMemberCredential(grant: string, siteId: number, memberId: number): Promise<string | null>;
}

interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PostgresSiteMemberRepository implements SiteMemberRepository {
  private readonly db: Queryable;

  constructor(db: Queryable = new Pool(databaseConfigFromEnv())) {
    this.db = db;
  }

  async revokeMemberGrant(grant:string,siteId:number,memberId:number):Promise<void>{
    if(!/^cmg_[a-f0-9]{64}$/.test(grant))return;
    await this.db.query(`update consumer_member_grants set revoked_at=now() where token_hash=$1 and site_id=$2 and member_id=$3`,[hashToken(grant),siteId,memberId]);
  }

  async registerOAuthClient(name: string, redirectUris: string[]): Promise<string> {
    const id="swcc_"+randomBytes(24).toString("hex");
    await this.db.query(`insert into consumer_oauth_clients (id,name,redirect_uris,expires_at)
      values ($1,$2,$3,now()+interval '90 days')`,[id,name,JSON.stringify(redirectUris)]);
    return id;
  }

  async findOAuthClient(id: string): Promise<{name:string;redirectUris:string[]}|null> {
    const result=await this.db.query<{name:string;redirect_uris:unknown}>(`select name,redirect_uris from consumer_oauth_clients where id=$1 and expires_at>now()`,[id]);
    const row=result.rows[0]; if(!row)return null;
    const uris=typeof row.redirect_uris==="string"?JSON.parse(row.redirect_uris):row.redirect_uris;
    return Array.isArray(uris)&&uris.every(x=>typeof x==="string")?{name:row.name,redirectUris:uris}:null;
  }

  async storeOAuthCode(payload: string, ttlSeconds=600): Promise<string> {
    const code="coc_"+randomBytes(32).toString("hex");
    await this.db.query(`with pruned as (delete from consumer_oauth_codes where expires_at <= now())
      insert into consumer_oauth_codes (token_hash,payload,expires_at) values ($1,$2,now()+($3 * interval '1 second'))`,[hashToken(code),payload,Math.min(600,Math.max(1,ttlSeconds))]);
    return code;
  }

  async consumeOAuthCode(code: string): Promise<string | null> {
    if (!/^coc_[a-f0-9]{64}$/.test(code)) return null;
    const result=await this.db.query<{payload:string}>(`delete from consumer_oauth_codes
      where token_hash=$1 and expires_at>now() returning payload`,[hashToken(code)]);
    return result.rows[0]?.payload ?? null;
  }

  // Called only after provider verification and site-member provisioning.
  async issueMemberGrant(member: ClientMember): Promise<string> {
    const token = "cmg_" + randomBytes(32).toString("hex");
    const result = await this.db.query<{id: number}>(`
      insert into consumer_member_grants (site_id, member_id, token_hash, expires_at, created_at, updated_at)
      select site_id, id, $3, now() + interval '7 days', now(), now()
      from members where site_id = $1 and id = $2 and status = 'active' and google_id = $4
      returning id`, [member.siteId, member.id, hashToken(token), member.googleId]);
    if (!result.rows.length) throw new Error("Active verified member is required.");
    return token;
  }

  async issueMemberCredential(grant: string, siteId: number, memberId: number): Promise<string | null> {
    if (!/^cmg_[a-f0-9]{64}$/.test(grant)) return null;
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    const token = "cmc_" + createHmac("sha256", grant).update(`consumer-access-v1:${bucket}`).digest("hex");
    // A new access credential never extends the absolute grant lifetime.
    const result = await this.db.query<{id: number}>(`
      with pruned as (
        delete from consumer_member_credentials c using consumer_member_grants g
        where c.grant_id = g.id and g.token_hash = $1 and g.site_id = $2 and g.member_id = $3 and c.expires_at <= now()
      )
      insert into consumer_member_credentials (grant_id, site_id, member_id, token_hash, expires_at, created_at, updated_at)
      select g.id, g.site_id, g.member_id, $4, least(g.expires_at, to_timestamp($5)), now(), now()
      from consumer_member_grants g join members m on m.id = g.member_id and m.site_id = g.site_id
      where g.token_hash = $1 and g.site_id = $2 and g.member_id = $3
        and g.revoked_at is null and g.expires_at > now() and m.status = 'active'
      on conflict (token_hash) do update set updated_at = consumer_member_credentials.updated_at
      where consumer_member_credentials.revoked_at is null and consumer_member_credentials.expires_at > now()
      returning id`, [hashToken(grant), siteId, memberId, hashToken(token), (bucket + 2) * 15 * 60]);
    return result.rows.length ? token : null;
  }

  async findSiteByCallbackCode(callbackCode: string): Promise<ClientSite | null> {
    const result = await this.db.query<{
      id: number;
      callback_code: string;
      name: string;
    }>(
      `
        select id, callback_code, name
        from sites
        where callback_code = $1
        limit 1
      `,
      [callbackCode],
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: numericId(row.id, "site id"),
      callbackCode: row.callback_code,
      name: row.name,
    };
  }

  async provisionMember(
    siteId: number,
    profile: GoogleProfile,
  ): Promise<ClientMember> {
    const byGoogle = await this.findMemberByGoogleId(siteId, profile.sub);

    if (byGoogle) {
      return this.touchMember(byGoogle.id, profile);
    }

    const byEmail = await this.findMemberByEmail(siteId, profile.email);

    if (byEmail) {
      return this.attachGoogleId(byEmail.id, profile);
    }

    const result = await this.db.query<MemberRow>(
      `
        insert into members (site_id, email, name, google_id, status, last_login_at, created_at, updated_at)
        values ($1, $2, $3, $4, 'active', now(), now(), now())
        returning id, site_id, email, name, google_id
      `,
      [siteId, profile.email, profile.name, profile.sub],
    );

    return memberFromRow(result.rows[0]);
  }

  private async findMemberByGoogleId(
    siteId: number,
    googleId: string,
  ): Promise<ClientMember | null> {
    const result = await this.db.query<MemberRow>(
      `
        select id, site_id, email, name, google_id
        from members
        where site_id = $1 and google_id = $2
        limit 1
      `,
      [siteId, googleId],
    );

    return result.rows[0] ? memberFromRow(result.rows[0]) : null;
  }

  private async findMemberByEmail(
    siteId: number,
    email: string,
  ): Promise<ClientMember | null> {
    const result = await this.db.query<MemberRow>(
      `
        select id, site_id, email, name, google_id
        from members
        where site_id = $1 and lower(email) = lower($2)
        limit 1
      `,
      [siteId, email],
    );

    return result.rows[0] ? memberFromRow(result.rows[0]) : null;
  }

  private async touchMember(
    memberId: number,
    profile: GoogleProfile,
  ): Promise<ClientMember> {
    const result = await this.db.query<MemberRow>(
      `
        update members
        set email = $2, name = $3, last_login_at = now(), updated_at = now()
        where id = $1
        returning id, site_id, email, name, google_id
      `,
      [memberId, profile.email, profile.name],
    );

    return memberFromRow(result.rows[0]);
  }

  private async attachGoogleId(
    memberId: number,
    profile: GoogleProfile,
  ): Promise<ClientMember> {
    const result = await this.db.query<MemberRow>(
      `
        update members
        set google_id = $2, name = $3, last_login_at = now(), updated_at = now()
        where id = $1
        returning id, site_id, email, name, google_id
      `,
      [memberId, profile.sub, profile.name],
    );

    return memberFromRow(result.rows[0]);
  }
}

function memberFromRow(row: MemberRow): ClientMember {
  return {
    id: numericId(row.id, "member id"),
    siteId: numericId(row.site_id, "member site_id"),
    email: row.email,
    name: row.name,
    googleId: row.google_id,
  };
}

function numericId(value: number | string, label: string): number {
  const id = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label} returned from Webless database.`);
  }

  return id;
}

function databaseConfigFromEnv() {
  return {
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number.parseInt(process.env.DB_PORT, 10) : undefined,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    ssl:
      process.env.DB_SSLMODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  };
}

interface MemberRow {
  id: number | string;
  site_id: number | string;
  email: string;
  name: string;
  google_id: string;
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
