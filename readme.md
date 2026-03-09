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
| `deviceIndex` | `0` | IR transmitter index on the device |
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

### IR routing table

Configure the device to forward received IR codes to another device:

```js
await irtx.setRoutingTable([
    {
        srcProtocol: "NEC",
        srcCode: 0x20DF10EFn,
        dstProtocol: "NEC",
        dstCode: 0x20DF10EFn,
        dstIp: "192.168.1.101",    // forward to another irtx device
    },
    {
        srcProtocol: "NEC",
        srcCode: 0x20DF20DFn,
        dstProtocol: "NEC",
        dstCode: 0x20DF20DFn,
        dstIp: "0.0.0.0",         // retransmit locally
    },
]);
```

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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.