import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresSiteMemberRepository,
  type GoogleProfile,
} from "../src/site-member-repository.js";

test("provisionMember normalizes PostgreSQL bigint ids to numbers", async () => {
  const profile: GoogleProfile = {
    sub: "google-123",
    email: "eric@example.test",
    name: "Eric",
    picture: "",
  };
  const queries: string[] = [];
  const repository = new PostgresSiteMemberRepository({
    query: async <T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> => {
      queries.push(sql);

      if (sql.includes("where site_id = $1 and google_id = $2")) {
        return { rows: [] };
      }

      if (sql.includes("where site_id = $1 and lower(email) = lower($2)")) {
        return { rows: [] };
      }

      return {
        rows: [
          {
            id: "24",
            site_id: "1",
            email: profile.email,
            name: profile.name,
            google_id: profile.sub,
          },
        ] as T[],
      };
    },
  });

  const member = await repository.provisionMember(1, profile);

  assert.equal(member.id, 24);
  assert.equal(member.siteId, 1);
  assert.equal(typeof member.id, "number");
  assert.equal(typeof member.siteId, "number");
  assert.equal(queries.length, 3);
});

test("findSiteByCallbackCode normalizes PostgreSQL bigint site ids to numbers", async () => {
  const repository = new PostgresSiteMemberRepository({
    query: async <T = Record<string, unknown>>(): Promise<{ rows: T[] }> => ({
      rows: [
        {
          id: "1",
          callback_code: "swcb_test",
          name: "SlimWeb",
        },
      ] as T[],
    }),
  });

  const site = await repository.findSiteByCallbackCode("swcb_test");

  assert.equal(site?.id, 1);
  assert.equal(typeof site?.id, "number");
  assert.equal(site?.callbackCode, "swcb_test");
});
