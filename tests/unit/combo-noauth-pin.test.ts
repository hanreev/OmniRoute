/**
 * REGRESSION (#12697 x no-auth collision): a no-auth auto/* step carries the
 * synthetic connectionId "noauth" (SYNTHETIC_NOAUTH_CONNECTION_ID) with no
 * allowedConnectionIds. PR #12697's implicitPinAllowlist promoted that pin to a
 * hard ["noauth"] allowlist which no real DB row (nor the #9057 synthetic
 * fallback guard) can satisfy — every oc/* free model in auto/best-free then
 * 403'd with "excluded by this API key's connection allowlist / quota scope".
 *
 * The synthetic id is NOT an operator-chosen connection: it means "route
 * keylessly". Promoting it to a hard allowlist is semantically wrong. This test
 * locks in that the no-auth pin is treated as "no pin" so the whole pool (and
 * thus the no-auth path) is reachable — WITHOUT weakening #12697 for real
 * credentialed combo pins (covered separately by combo-pin-implicit-allowlist.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveComboTargets } from "../../open-sse/services/combo/comboStructure.ts";
import { SYNTHETIC_NOAUTH_CONNECTION_ID } from "../../open-sse/services/autoCombo/resilienceCandidateFilter.ts";

test("implicitPinAllowlist does not promote the synthetic no-auth pin to a hard allowlist", async () => {
  const { implicitPinAllowlist } = await import("../../src/lib/combos/steps.ts");
  // The no-auth auto step is pinned to the synthetic connection but has no
  // allowlist. It must behave like "no pin" (whole pool) — NOT ["noauth"].
  assert.equal(implicitPinAllowlist(SYNTHETIC_NOAUTH_CONNECTION_ID, undefined), null);
  assert.equal(implicitPinAllowlist(SYNTHETIC_NOAUTH_CONNECTION_ID, null), null);
  // An explicit allowlist on the no-auth step is still honored.
  assert.deepEqual(implicitPinAllowlist(SYNTHETIC_NOAUTH_CONNECTION_ID, ["real-conn"]), [
    "real-conn",
  ]);
  // Real credentialed pins keep #12697 fail-closed semantics.
  assert.deepEqual(implicitPinAllowlist("20x-account", undefined), ["20x-account"]);
  assert.deepEqual(implicitPinAllowlist("20x-account", []), ["20x-account"]);
});

test("comboPinAllowlist passes the synthetic no-auth pin through as no-allowlist", async () => {
  const { comboPinAllowlist } = await import("../../src/lib/combos/steps.ts");
  assert.equal(comboPinAllowlist(true, SYNTHETIC_NOAUTH_CONNECTION_ID, undefined), null);
  assert.equal(comboPinAllowlist(true, SYNTHETIC_NOAUTH_CONNECTION_ID, null), null);
  // Header-forced behavior stays intact for non-combo.
  assert.equal(comboPinAllowlist(false, SYNTHETIC_NOAUTH_CONNECTION_ID, undefined), null);
});

test("resolveComboTargets emits no allowedConnectionIds for a no-auth auto step", () => {
  const targets = resolveComboTargets(
    {
      name: "auto-best-free",
      strategy: "auto",
      models: [
        {
          kind: "model",
          model: "oc/muse-spark-1.2-contributor-free",
          connectionId: SYNTHETIC_NOAUTH_CONNECTION_ID,
        },
      ],
    },
    null
  );
  assert.equal(targets.length, 1);
  assert.equal(targets[0].connectionId, SYNTHETIC_NOAUTH_CONNECTION_ID);
  // The bug: this was ["noauth"], which the #9057 guard rejects and surfaces as 403.
  assert.equal(
    targets[0].allowedConnectionIds,
    undefined,
    "no-auth auto step must not gain an implicit allowlist"
  );
});

test("resolveComboTargets keeps #12697 pin semantics for a real credentialed pin", () => {
  const targets = resolveComboTargets(
    {
      name: "credentialed",
      strategy: "priority",
      models: [{ kind: "model", model: "claude/claude-code", connectionId: "20x-account" }],
    },
    null
  );
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].allowedConnectionIds, ["20x-account"]);
});
