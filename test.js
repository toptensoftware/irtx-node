import { IrtxDevice } from "./irtx.js";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Open device
const irtx = new IrtxDevice("10.1.1.101");

await irtx.setRoutingTable([
    // Map NEC to self
    {
        srcProtocol: "PANA",
        srcCode:     0x000040040D084144n,       // Pana OK button
        dstProtocol: "PANA",
        dstCode:     0x000040040D084144n,
        dstIp:       "blaster",
    },
]);

irtx.startListening();
irtx.on("ircode", console.log);

sleep(2000);

// Send code
await irtx.irSend("PANA:0x000040040D084144");


