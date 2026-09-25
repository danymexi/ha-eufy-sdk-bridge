import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeviceView } from "../src/device-view.mjs";

// A HomeBase-like device: reports one property, and accepts two write-only settings it never reports.
function fakeDevice() {
  return {
    sn: "T8030TEST",
    describe: () => ({ sn: "T8030TEST", name: "Base", model: "T8030", modelName: "HomeBase 3", codec: "station", capabilities: ["siren"] }),
    getProperties: () => ({ promptVolume: { value: 26 } }),
    properties: [{ name: "hubAlarmTone", type: "enum", writable: true, enumValues: { 0: "Tone1" } }],
    writeOnlySettings: [
      { name: "alarmVolume", type: "number", unit: "%", kind: "percent", min: 0, max: 100, description: "HomeBase alarm volume" },
    ],
  };
}

test("propertySpecs appends write-only settings, marked writeOnly + writable, with bounds", () => {
  const view = createDeviceView({ eufy: {}, state: { streaming: new Map() } });
  const specs = view.propertySpecs(fakeDevice());
  const tone = specs.find((s) => s.name === "hubAlarmTone");
  const vol = specs.find((s) => s.name === "alarmVolume");
  assert.ok(tone, "reported property is still present");
  assert.ok(vol, "write-only setting is exposed");
  assert.equal(vol.writeOnly, true);
  assert.equal(vol.writable, true);
  assert.equal(vol.min, 0);
  assert.equal(vol.max, 100);
  assert.equal(vol.kind, "percent");
  // A reported property carries no writeOnly flag.
  assert.equal(tone.writeOnly, undefined);
});
