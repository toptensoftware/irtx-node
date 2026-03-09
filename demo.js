import { IrtxDevice, irtxHidReportId } from "./index.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }


// Open device
const irtx = new IrtxDevice("my-irtx-blaster.lan");

// Send codes
await irtx.irSend([9000,2000,4000,2000]);
await irtx.irSend("NEC:0x7e8154ab");

// Connect BLE slot 1
await irtx.bleConnect(1);
await sleep(2000);  // allow time for device to connect. (TODO need to add a way to wait/check/poll this)

// Send a consumer input report
await irtx.bleSendHid(1, irtxHidReportId.consumer, [0xE9, 0x00]);       // Press volume up
await sleep(10);
await irtx.bleSendHid(1, irtxHidReportId.consumer, [0x00, 0x00]);       // Release

//await irtx.bleSendHid(1, irtxHidReportId.keyboard, [modifiers, 0, k1, k2, k3, k4, k5, k6]);
//await irtx.bleSendHid(1, irtxHidReportId.mouse, [buttons, dx, dy, wheel]);

// Disconnect BLE
await irtx.bleConnect(-1);

// Close device
irtx.close();
