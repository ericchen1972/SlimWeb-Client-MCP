import assert from "node:assert/strict";
import test from "node:test";
import {Script} from "node:vm";
import {productListWidgetContents} from "../src/widgets.js";

test("quote widget displays full server discounts and gifts with safe text nodes", () => {
  const html = JSON.stringify(productListWidgetContents());
  for (const key of ["quantity_discount", "member_tier_discount", "coupon_discount", "discount_code_discount", "merchandise_total", "preview.gift", "pricing_status", "review_required", "expired"]) assert.ok(html.includes(key), key);
  assert.ok(!html.includes("totalsTable.innerHTML"));
});


test("quote widget browser script parses", () => {
  const html = productListWidgetContents().text;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Script(script[1]));
});


test("quote widget new labels follow browser language", () => {
  const html = productListWidgetContents().text;
  assert.ok(html.includes('navigator.language'));
  for (const text of ["數量折扣", "會員等級折扣", "優惠券折抵", "折扣碼折抵", "商品折扣後金額", "贈品", "報價已過期"]) assert.ok(html.includes(text), text);
});
