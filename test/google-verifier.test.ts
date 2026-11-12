import assert from "node:assert/strict";
import test from "node:test";
import { GoogleIdentityVerifier } from "../src/google-verifier.js";
test("Google identity rejects unverified email before member linking", async () => {
 const verifier = new GoogleIdentityVerifier({clientId:"client",fetchImpl: (async () => Response.json({aud:"client",sub:"subject",email:"buyer@example.test",email_verified:"false",exp:Math.floor(Date.now()/1000)+60,iss:"https://accounts.google.com"})) as typeof fetch});
 await assert.rejects(verifier.verify("token"));
});
