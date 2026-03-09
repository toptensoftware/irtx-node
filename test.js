import { IrtxDevice } from "./irtx.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Open device
const irtx = new IrtxDevice("10.1.1.187");

// Send code
await irtx.irSend("NEC:0x7e8154ab");

irtx.close();
