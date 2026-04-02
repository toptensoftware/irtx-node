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

The `--delay <ms>` option sets the inter-packet delay for `ble-hid` and `ble-keys` (default: 30ms).

### `send`

Sends an IR code to the device:

```bash
irtx --host <ip> send <PROTOCOL:CODE>
```

```bash
irtx --host 192.168.1.100 send NEC:0x20DF10EF
```

### `activities`

Packs an activities configuration file, writes the packed binary to `<file>.bin`
in the same directory as the input file, and uploads it to the device:

```bash
irtx --host <ip> activities <file.js|file.json>
```

`--host` is required. The type definitions (`binpack.js`) are fetched directly
from the target device, so the packed output always matches the connected
firmware's schema.

```bash
irtx --host 192.168.1.100 activities activities.js
```

This writes `activities.bin` alongside the source file and uploads it to the device.

The configuration file is a `.js` or `.json` file that exports the activities
data as its default export. `.js` files can import helpers from `binpack:types`:

```js
import { op, riff, opId, bindingType, irEventKindMask } from "binpack:types";

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

The `binpack:types` specifier is provided at runtime by the CLI — no separate
install is needed.

### `ble-connect`

Connects a BLE slot by index:

```bash
irtx --host <ip> ble-connect <slot>
```

### `ble-disconnect`

Disconnects all BLE slots:

```bash
irtx --host <ip> ble-disconnect
```

### `ble-hid`

Sends one or more raw BLE HID reports. Each argument after the report ID is a
separate packet sent with a 30ms delay between them. Use `!` as an argument to
introduce a delay without sending a packet.

```bash
irtx --host <ip> ble-hid <reportId> <hexdata> [<hexdata> ...]
```

Report IDs: `1` = keyboard, `2` = consumer, `3` = mouse.

Hex data is a string of hex digits with optional commas (e.g. `0102FF` or `01,02,FF`).

```bash
# Consumer report: volume up press then release
irtx --host 192.168.1.100 ble-hid 2 E900 0000

# Extra delay between press and release
irtx --host 192.168.1.100 ble-hid 2 E900 ! 0000

# Override inter-packet delay to 100ms
irtx --host 192.168.1.100 --delay 100 ble-hid 2 E900 0000
```

### `ble-type`

Types an ASCII string as BLE HID keyboard keystrokes (US 101 keyboard layout).
Each character is sent as a key-press/key-release pair with a short inter-keystroke delay.

```bash
irtx --host <ip> ble-type <text>
```

```bash
irtx --host 192.168.1.100 ble-type "hello world"
```

### `ble-keys`

Sends a sequence of named key events as BLE HID keyboard reports. Prefix a key
name with `!` to release it. The state of all held keys and modifiers is tracked
across the sequence, and any keys still held at the end are automatically released.

```bash
irtx --host <ip> ble-keys <key> [<key> ...]
```

```bash
# Press Ctrl+C then release both
irtx --host 192.168.1.100 ble-keys ctrl c !c !ctrl

# Press Ctrl+Alt+Delete
irtx --host 192.168.1.100 ble-keys ctrl alt delete

# Override inter-key delay to 50ms
irtx --host 192.168.1.100 --delay 50 ble-keys shift f10
```

Available modifier keys: `ctrl` `lctrl` `shift` `lshift` `alt` `lalt` `gui` `win` `cmd`
`lgui` `lwin` `rctrl` `rshift` `ralt` `altgr` `rgui` `rwin`

Regular keys: `a`–`z`, `0`–`9`, `f1`–`f12`, `enter`/`return`, `esc`/`escape`,
`backspace`/`bksp`, `tab`, `space`, `insert`/`ins`, `delete`/`del`, `home`, `end`,
`pageup`/`pgup`, `pagedown`/`pgdn`, `up`, `down`, `left`, `right`, `capslock`,
`scrolllock`, `numlock`, `printscreen`/`prtscr`, `pause`, `minus`, `equals`,
`lbracket`, `rbracket`, `backslash`, `semicolon`, `apostrophe`, `grave`, `comma`,
`period`, `slash`, `app`/`menu`

Run `irtx --list-keys` to print the full list.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.