import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, createSignedToken, verifySessionToken, sealOAuthPayload, openOAuthPayload } from "../src/session.js";
const identity = {site_id:7,callback_code:"site",member_id:1,email:"buyer@example.test",google_id:"google",member_grant:"cmg_"+"a".repeat(64)};
test("legacy identity-only sessions cannot mint member access",()=>{
 const {member_grant,...legacy}=identity;
 assert.equal(verifySessionToken(createSignedToken({...legacy,exp:9999999999},"secret"),"secret"),null);
});
test("session exchange cannot extend original absolute expiry",()=>{
 const now=Date.now(), end=Math.floor(now/1000)+60;
 const token=createSessionToken(identity,"secret",now,end);
 assert.equal(verifySessionToken(token,"secret",now)?.exp,end);
 assert.equal(verifySessionToken(token,"secret",end*1000),null);
});

test("OAuth code shaped payload is never accepted as a consumer session",()=>{
 assert.equal(verifySessionToken(createSignedToken({...identity,typ:"oauth_code",exp:9999999999},"secret"),"secret"),null);
});

test("OAuth payload ciphertext is purpose bound and tamper evident",()=>{
 const sealed=sealOAuthPayload({...identity,typ:"oauth_code"},"secret");
 assert.ok(!sealed.includes(identity.member_grant));
 assert.deepEqual(openOAuthPayload(sealed,"secret"),{...identity,typ:"oauth_code"});
 assert.equal(openOAuthPayload(sealed,"other-secret"),null);
 assert.equal(openOAuthPayload(sealed.slice(0,-6)+"aaaaaa","secret"),null);
 assert.equal(verifySessionToken(sealed,"secret"),null);
});
