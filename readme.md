# irtx-node

Node library for [irtx](https://github.com/toptensoftware/irtx).

See also [@toptensoftware/irlib](https://github.com/toptensoftware/irlib) for helpers to generate and decode IR signals.

## Installation

```bash
npm install --save toptensoftware/irtx-node
```

## Usage

Import `IrtxDevice` and create an instance for each device. The constructor opens
the UDP socket immediately; call `close()` when done.

```js
import { IrtxDevice, irtxHidReportId } from "@toptensoftware/irtx-node";

const irtx = new IrtxDevice("192.168.1.100");   // optional second arg: port (default 4210)

// ... use the device ...

irtx.close();
```

### Sending IR signals

Three input formats are accepted:

```js
// Raw timing data (microseconds — mark/space pairs, last value is the trailing gap)
await irtx.irSend([9000, 4500, 560, 560, 560, 1690, 560]);

// "PROTOCOL:CODE" shorthand string
await irtx.irSend("NEC:0x20DF10EF");

// Explicit object
await irtx.irSend({ protocol: "NEC", code: "0x20DF10EF", repeat: false });
```

Options (second argument, applies to all formats):

| Option | Default | Description |
|---|---|---|
| `carrierFrequency` | `38000` | Carrier frequency in Hz (raw timing mode only) |
| `repeat` | `false` | Send as a repeat frame (protocol mode only) |

### BLE HID

Connect a BLE device to a slot, then send HID reports through it:

```js
await irtx.bleConnect(1);           // connect slot 1  (-1 disconnects all)

// Consumer report — volume up
await irtx.bleSendHid(1, irtxHidReportId.consumer, [0xE9, 0x00]);  // press
await irtx.bleSendHid(1, irtxHidReportId.consumer, [0x00, 0x00]);  // release

// Keyboard report — [modifiers, reserved, key1..key6]
await irtx.bleSendHid(1, irtxHidReportId.keyboard, [0, 0, 0x04, 0, 0, 0, 0, 0]);

// Mouse report — [buttons, dx, dy, wheel]
await irtx.bleSendHid(1, irtxHidReportId.mouse, [0, 10, 0, 0]);

await irtx.bleConnect(-1);          // disconnect all
```

### Switch activity

Switch the device to a different activity by zero-based index:

```js
await irtx.switchActivity(0);   // activate the first activity
await irtx.switchActivity(2);   // activate the third activity
```

### Receiving IR codes (UDP listener)

Use `startListening()` to receive IR codes forwarded by the device:

```js
const receiver = new IrtxDevice("192.168.1.100");

receiver.on('ircode', ({ protocol, code, repeat, remoteAddress }) => {
    console.log(`IR from ${remoteAddress}: proto=0x${protocol.toString(16)} code=0x${code.toString(16)} repeat=${repeat}`);
});

await receiver.startListening();    // optional arg: port (default 4210)

// ... later ...
receiver.stopListening();
```

`startListening()` binds a UDP socket on the specified port and emits an `'ircode'` event for
each valid cmd 4 packet received. `stopListening()` closes that socket (it is also called
automatically by `close()`).

The `'ircode'` event payload:

| Property | Type | Description |
|---|---|---|
| `protocol` | `number` | FourCC protocol identifier |
| `code` | `bigint` | 64-bit IR code value |
| `repeat` | `boolean` | Whether this is a repeat frame |
| `remoteAddress` | `string` | IP address of the sender |
| `remotePort` | `number` | UDP port of the sender |




### Multiple devices

Each `IrtxDevice` instance is independent, so multiple devices can be used simultaneously:

```js
const tv  = new IrtxDevice("192.168.1.100");
const amp = new IrtxDevice("192.168.1.101");

await tv.irSend("NEC:0x20DF10EF");
await amp.irSend("NEC:0x4B36D52A");

tv.close();
amp.close();
```

## Command Line Tool

### Installation

Install globally to use the `irtx` command anywhere:

```bash
npm install -g toptensoftware/irtx-node
```

Or run without installing via npx:

```bash
npx toptensoftware/irtx-node <command> [args]
```

### Specifying the device

All commands that communicate with a device require a host address, either via
the `--host` flag or the `IRTX_HOST` environment variable:

```bash
irtx --host 192.168.1.100 send NEC:0x20DF10EF
IRTX_HOST=192.168.1.100 irtx send NEC:0x20DF10EF
```

The UDP port defaults to `4210` and can be overridden with `--port`.

### `send`

Sends an IR code to the device:

```bash
irtx --host <ip> send <PROTOCOL:CODE>
```

```bash
irtx --host 192.168.1.100 send NEC:0x20DF10EF
```

### `configure`

Packs an activities configuration file and uploads it to the device:

```bash
irtx --host <ip> configure <file.js|file.json>
```

If `--host` is omitted, the packed binary is written to `<file>.bin` in the
same directory as the input file instead of being uploaded.

```bash
# Upload directly to device
irtx --host 192.168.1.100 configure activities.js

# Pack to activities.bin without uploading
irtx configure activities.js
```

The configuration file is a `.js` or `.json` file that exports the activities
data as its default export. `.js` files can import helpers from `irtx:binpack`:

```js
import { op, riff, opId, bindingType, irEventKindMask } from "irtx:binpack";

export default {
    version: 1,
    devices: [
        { name: "TV" },
    ],
    activities: [
        {
            name: "Watch TV",
            devices: ["TV"],
            bindings: [
                {
                    type: bindingType.ir,
                    protocol: riff("NEC"),
                    code: 0x20DF10EFn,
                    eventKindMask: irEventKindMask.press,
                    ops: [ op.sendIr("NEC:0x20DF10EF") ],
                }
            ]
        }
    ]
};
```

The `irtx:binpack` specifier is provided at runtime by the CLI — no separate
install is needed. The type definitions are fetched fresh from the
[irtx](https://github.com/toptensoftware/irtx) repo each time `configure` runs,
so the packed output always matches the current firmware schema.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.