# irtx-node

Node library for [irtx](https://github.com/toptensoftware/irtx).

See also [@toptensoftware/irlib](https://github.com/toptensoftware/irlib) for helpers to generate and decode IR signals.

## Installation

```bash
npm install --save toptensoftware/irtx-node
```

## Usage

```js
function irtxOpen(address, port = 4210);
```



```js
import { irtxOpen, irtxClose, irtxIrSend, irtxBleConnect, irtxBleSendHid, irtxHidReportId } from "@toptensoftware/irtx-node";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }


// Open device
irtxOpen("10.1.1.187");

// Send code (use @toptensoftware/irlib to generate timing data)
await irtxIrSend([9000,2000,4000,2000, /** etc **/ ]);

// Connect BLE slot 1
await irtxBleConnect(1);
await sleep(2000);  // allow time for device to connect. (TODO need to add a way to wait/check/poll this)

// Send a consumer input report
await irtxBleSendHid(1, irtxHidReportId.consumer, [0xE9, 0x00]);       // Press volume up
await sleep(10);
await irtxBleSendHid(1, irtxHidReportId.consumer, [0x00, 0x00]);       // Release

//await irtxBleSendHid(1, irtxHidReportId.keyboard, [modifiers, 0, k1, k2, k3, k4, k5, k6]);
//await irtxBleSendHid(1, irtxHidReportId.mouse, [buttons, dx, dy, wheel]);

// Disconnect BLE
await irtxBleConnect(-1);

// Close device
irtxClose();
```


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.