import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateUsername, sanitizeUsername, sanitizeLogin, sanitizeVodId, validatePassword,
  sanitizeNumber, escapeHtml, sanitizeUrl, validateCategoryName, sanitizeText,
} from "@/lib/security/sanitize";

test("validateUsername accepts valid names and lowercases them", () => {
  assert.deepEqual(validateUsername("Alice_1"), { isValid: true, value: "alice_1" });
  assert.equal(validateUsername("  bob  ").value, "bob");
});

test("validateUsername requires at least 3 characters", () => {
  assert.equal(validateUsername("ab").isValid, false);
  assert.equal(validateUsername("abc").isValid, true);
});

test("validateUsername rejects bad length, leading digits, symbols and non-strings", () => {
  assert.equal(validateUsername("a".repeat(25)).isValid, true);
  assert.equal(validateUsername("a".repeat(26)).isValid, false);
  assert.equal(validateUsername("1abc").isValid, false);
  assert.equal(validateUsername("a b c").isValid, false);
  assert.equal(validateUsername("name-with-dash").isValid, false);
  for (const bad of [null, undefined, 42, {}, []]) assert.equal(validateUsername(bad).isValid, false);
});

test("validateUsername blocks script and HTML vectors", () => {
  for (const bad of ["<b>bold", "x<script>", "javascript:alert", "onload=evil", "data:text/html"]) {
    assert.equal(validateUsername(bad).isValid, false, bad);
  }
});

test("sanitizeUsername returns the value or null", () => {
  assert.equal(sanitizeUsername("Valid_Name"), "valid_name");
  assert.equal(sanitizeUsername("no spaces"), null);
});

test("sanitizeLogin normalizes channel logins and rejects anything else", () => {
  assert.equal(sanitizeLogin("  XQC "), "xqc");
  assert.equal(sanitizeLogin("a"), null); // min 2
  assert.equal(sanitizeLogin("a".repeat(31)), null);
  assert.equal(sanitizeLogin("bad-name"), null);
  assert.equal(sanitizeLogin("../etc"), null);
  assert.equal(sanitizeLogin(123), null);
});

test("sanitizeVodId keeps digits only and bounds the length", () => {
  assert.equal(sanitizeVodId("12345"), "12345");
  assert.equal(sanitizeVodId(12345), "12345");
  assert.equal(sanitizeVodId("v123abc"), "123");
  assert.equal(sanitizeVodId("abc"), null);
  assert.equal(sanitizeVodId(""), null);
  assert.equal(sanitizeVodId("1".repeat(21)), null);
  assert.equal(sanitizeVodId("1".repeat(20)), "1".repeat(20));
  for (const bad of [null, undefined, {}, true]) assert.equal(sanitizeVodId(bad), null);
});

test("validatePassword enforces length and null bytes but allows symbols", () => {
  assert.equal(validatePassword("12345").isValid, false);
  assert.equal(validatePassword("123456").isValid, true);
  assert.equal(validatePassword("p<a>$$'\"w").isValid, true);
  assert.equal(validatePassword("x".repeat(128)).isValid, true);
  assert.equal(validatePassword("x".repeat(129)).isValid, false);
  assert.equal(validatePassword("abc\0def").isValid, false);
  assert.equal(validatePassword(123456).isValid, false);
});

test("sanitizeNumber clamps, floors, parses strings and falls back", () => {
  assert.equal(sanitizeNumber(5.9, 0, 10), 5);
  assert.equal(sanitizeNumber(-5, 0, 10), 0);
  assert.equal(sanitizeNumber(99, 0, 10), 10);
  assert.equal(sanitizeNumber(" 7 ", 0, 10), 7);
  assert.equal(sanitizeNumber("12abc", 0, 100), 12);
  assert.equal(sanitizeNumber(NaN, 0, 10, 3), 3);
  assert.equal(sanitizeNumber("abc", 0, 10, 4), 4);
  assert.equal(sanitizeNumber(null, 0, 10, 2), 2);
});

test("escapeHtml escapes every dangerous character", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;&#x2F;a&gt;");
});

test("sanitizeUrl only passes http(s) and safe relative paths", () => {
  assert.equal(sanitizeUrl("https://static-cdn.jtvnw.net/a.png"), "https://static-cdn.jtvnw.net/a.png");
  assert.equal(sanitizeUrl("http://example.com"), "http://example.com/");
  assert.equal(sanitizeUrl("/relative/path"), "/relative/path");
  for (const bad of [
    "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<x>", "vbscript:x", "file:///etc/passwd",
    "ftp://example.com", "//evil.com", "/\\evil.com", "https://a.com/\u0000", "", "   ", null, 5,
  ]) {
    assert.equal(sanitizeUrl(bad), "", String(bad));
  }
  assert.equal(sanitizeUrl("https://a.com/" + "x".repeat(600)), ""); // over maxLength
});

test("validateCategoryName accepts game titles and rejects injection", () => {
  for (const ok of ["Just Chatting", "Dota 2", "Pokémon Legends: Arceus", "Tom Clancy's R6", "Art & Design"]) {
    assert.equal(validateCategoryName(ok).isValid, true, ok);
  }
  for (const bad of ["", "   ", "<script>", "x".repeat(101), "Game; DROP TABLE", "onclick=evil()", "a\u0000b", 5]) {
    assert.equal(validateCategoryName(bad).isValid, false, String(bad));
  }
  assert.equal(validateCategoryName("  Dota 2  ").value, "Dota 2");
});

test("sanitizeText strips tags, quotes, control characters and script prefixes, then truncates", () => {
  assert.equal(sanitizeText("<b>hi</b>"), "hi");
  assert.equal(sanitizeText(`say "hi" it's`), "say hi its");
  assert.equal(sanitizeText("a\u0000b\u0007c"), "abc");
  assert.equal(sanitizeText("javascript:alert(1)"), "alert(1)");
  assert.equal(sanitizeText("click onmouseover=x now"), "click x now");
  assert.equal(sanitizeText("x".repeat(300), 10), "x".repeat(10));
  assert.equal(sanitizeText(42), "");
});
