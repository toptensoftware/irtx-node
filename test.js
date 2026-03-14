import { IrtxDevice } from "./irtx.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Open device
const irtx = new IrtxDevice("10.1.1.101");

await irtx.switchActivity(0);

irtx.startListening();
irtx.on("ircode", console.log);

sleep(2000);

// Send code
await irtx.irSend("PANA:0x000040040D084144");


