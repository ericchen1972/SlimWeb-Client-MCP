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
