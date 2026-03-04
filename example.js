import { protocolNec, irtxOpen, irtxClose, irtxIrSend,
         irtxBleConnect, irtxBleSendHid, irtxHidReportId } from "./irtx.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }


// Open device
irtxOpen("10.1.1.187");

// Send code
await irtxIrSend(0x12345678, { protocol: protocolNec, repeat: false });

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