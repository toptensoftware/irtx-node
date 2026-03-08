import { irtxOpen, irtxClose, irtxIrSend } from "./irtx.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Open device
irtxOpen("10.1.1.187");

// Send code
await irtxIrSend("NEC:0x7e8154ab");

irtxClose();
