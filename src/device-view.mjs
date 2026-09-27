// The host-facing view of a device: identity + capabilities + live property values + a stream path for
// cameras. This is the shape the WS `devices.list` / `device.state` / `device.properties` commands and
// the go2rtc camera registration both read, so a camera is "a device describeDevice gave a `stream`",
// not `deviceClass === "camera"` (the SDK downgrades a camera behind a HomeBase to "other").

export function createDeviceView(ctx) {
  const { eufy } = ctx;
  const { streaming } = ctx.state;

  /**
   * Build the host-facing summary of one device: identity + capabilities + a stream path for a camera.
   *
   * `name` is the owner's device name (falling back to the product name when unnamed), `model` is the
   * T-code, `modelName` is the product. A host shows `name` as the device name and `model`/`modelName`
   * as its model — no cross-referencing the device list.
   */
  /** A registry record's `device_channel` as an integer, or null when absent/unparseable. */
  function channelFromRaw(raw) {
    const n = Number(raw);
    return raw !== undefined && raw !== null && Number.isInteger(n) ? n : null;
  }

  /** The camera's channel on its station, from the registry record (the device model does not carry it). */
  async function channelOf(sn) {
    return channelFromRaw((await eufy.getDevices()).find((d) => d.sn === sn)?.raw?.device_channel);
  }

  /**
   * `channel` may be passed in by a caller that already holds the registry (the device list),
   * so describing 32 devices costs ONE `getDevices()` rather than one per device — the per-device
   * lookup made `devices.list` take ~7 s, and HA's 15 s poll timeout then tripped under any extra
   * load, marking every entity unavailable.
   */
  async function describeDevice(sn, channel) {
    const dev = await eufy.getDevice(sn);
    const m = dev.describe();
    const isCamera = m.capabilities.includes("camera") || m.capabilities.includes("video");
    return {
      sn: m.sn,
      // The station this device hangs off and its channel there (null for a station itself / unknown).
      stationSn: dev.stationSn ?? m.stationSn ?? null,
      channel: channel !== undefined ? channel : await channelOf(sn),
      name: m.name, // owner's device name (e.g. "Dining room"), from device_name
      model: m.model || m.modelName, // T-code (e.g. "T8410"); product name as fallback
      modelName: m.modelName, // product display name (e.g. "Indoor Cam Pan & Tilt")
      codec: m.codec,
      capabilities: m.capabilities,
      state: propertyState(dev), // live property values ({ battery: 74, motion: false, … })
      stream: isCamera ? `/stream/${m.sn}` : undefined,
      streaming: isCamera ? streaming.has(m.sn) : undefined, // live P2P feed active right now?
      canReboot: m.codec === "station", // HomeBase-only; drives a Reboot button in HA
    };
  }

  /** Live property values as a flat `{ name: value }` map (reading schedules a background refresh). */
  function propertyState(dev) {
    const out = {};
    for (const [name, pv] of Object.entries(dev.getProperties())) out[name] = pv.value;
    return out;
  }

  /**
   * The device's property manifest — the host-relevant half of each PropertySpec, so a frontend can
   * build the right entity (writable bool → switch, enum → select, number → number, else sensor)
   * without knowing eufy wire ids. Wire-only fields (paramType, decode, aliases) are omitted.
   */
  function propertySpecs(dev) {
    const reported = (dev.properties ?? []).map((p) => ({
      name: p.name,
      type: p.type, // "bool" | "number" | "string" | "enum"
      unit: p.unit, // "%", "°C", "dBm", …
      kind: p.kind, // percent | celsius | dbm | seconds | …
      writable: p.writable, // a setter exists (device.set accepts it)
      enumValues: p.enumValues, // { raw: label } for enums
      description: p.description,
    }));
    // Write-only settings a device ACCEPTS but never reports back (e.g. a HomeBase's alarm volume). They
    // are not in `dev.properties` — that manifest is what the device reports — so a host would otherwise
    // never learn the control exists. Marked `writeOnly` so a frontend shows an optimistic control
    // (the device won't confirm the value) and drives it through the same `device.set` path.
    // A device can declare a write-only setting whose name a reported property already carries (a
    // doorbell reports `ringtoneVolume` AND accepts a write-only one). The reported spec wins — it has a
    // live value — so a write-only is added only when the name is new, or a host builds two entities
    // with the same unique id.
    const reportedNames = new Set(reported.map((p) => p.name));
    const writeOnly = (dev.writeOnlySettings ?? [])
      .filter((p) => !reportedNames.has(p.name))
      .map((p) => ({
        name: p.name,
        type: p.type,
        unit: p.unit,
        kind: p.kind,
        writable: true,
        writeOnly: true,
        min: p.min,
        max: p.max,
        enumValues: p.enumValues,
        description: p.description,
      }));
    return [...reported, ...writeOnly];
  }

  async function deviceList() {
    const devices = await eufy.getDevices();
    // One registry read for the whole list: hand each device its channel instead of re-reading.
    const channelBySn = new Map(devices.map((d) => [d.sn, channelFromRaw(d?.raw?.device_channel)]));
    return Promise.all(
      devices.map((d) =>
        describeDevice(d.sn, channelBySn.get(d.sn)).catch((e) => ({
          sn: d.sn,
          error: String(e?.message ?? e),
        })),
      ),
    );
  }

  return { describeDevice, propertyState, propertySpecs, deviceList };
}
