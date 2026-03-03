import { protocolNec, irtx_open, irtx_close, irtx_send } from "./irtx.js";

irtx_open("10.1.1.187");
await irtx_send(0x12345678, { protocol: protocolNec, repeat: false });
irtx_close();

