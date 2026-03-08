import dgram from "node:dgram";

const commandSendIr = 1;
const commandBleConnect = 2;
const commandBleSendHid = 3;
const commandSendIrCode = 4;
const commandSetRoutingTable = 5;

// Currently open irtx device
let ESP32_IP = null;
let UDP_PORT = null;
let sock = null;

export function riff(a) 
{
    if (typeof(a) === "string")
    {
        while (a.length < 4)
            a = a + "  ";

        return (a.charCodeAt(0)) |
            (a.charCodeAt(1) << 8) |
            (a.charCodeAt(2) << 16) |
            (a.charCodeAt(3) << 24);
    }
    throw new Error("Invalid riff value");
}

function writeIPv4(buf, ip, offset) 
{
    const parts = ip.split('.');
    buf[offset]     = parseInt(parts[0]);
    buf[offset + 1] = parseInt(parts[1]);
    buf[offset + 2] = parseInt(parts[2]);
    buf[offset + 3] = parseInt(parts[3]);
}


// Write a uint64 into a Buffer at offset (as two uint32 LE halves)
function writeU64LE(buf, value, offset)
{
    // value may be a BigInt or a regular number
    const big = BigInt(value);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), offset);
    buf.writeUInt32LE(Number(big >> 32n),        offset + 4);
}

export const irtxHidReportId = {
    keyboard: 1,
    consumer: 2,
    mouse: 3,
}

// Open irtx for transmit
export function irtxOpen(ipaddress, port = 4210)
{
    if (sock)
        throw new Error("Already open");

    ESP32_IP = ipaddress;
    UDP_PORT = port;
    sock = dgram.createSocket("udp4");
}

// Close irtx device
export function irtxClose()
{
    if (sock)
    {
        sock.close();
        sock = null;
    }
}

// Send a packet to the device
export function irtxSendPacket(pkt)
{
    if (Array.isArray(pkt))
    {
        pkt = Buffer.from(pkt);
    }

    console.log(pkt);

    return new Promise((resolve, reject) =>
    {
        sock.send(pkt, UDP_PORT, ESP32_IP, (err) =>
        {
            if (err)
                reject(err)
            else 
            {
                console.log(`Sent ${pkt.length} bytes to ${ESP32_IP}:${UDP_PORT}`);
                resolve();
            }
        });
    });
}


// Send an ircode
// data = array of timing data or
// data = string "PROT:CODE" (e.g. "NEC:0x20DF10EF") or
// data = object { protocol: "NEC", code: 0x20DF10EF, repeat: false }
// opts = options object
// opts.deviceIndex (default 0)
// opts.carrierFrequency (default 38000)
export function irtxIrSend(data, opts)
{
    // Resolve options
    opts = Object.assign({
        deviceIndex: 0,
        carrierFrequency: 38000,
        repeat: false
    }, opts);

    // String in format "PROT:CODE" (e.g. "NEC:0x20DF10EF")
    if (typeof(data) === "string")
    {
        let parts = data.split(":");
        if (parts.length == 2)
        {
            // Crack parameters
            let protocol = parts[0];
            let code = parts[1];
            data = { protocol, code };
        }
    }

    // Object with protcol and code properties (e.g. { protocol: 0x1234, code: 0x20DF10EF })    
    if (typeof(data) === "object" && data.protocol !== undefined && data.code !== undefined)
    {
        // Merge
        data = Object.assign({}, data, opts);

        // Normalize protocol
        let protocol = data.protocol;
        if (typeof(protocol) === "string")
            protocol = riff(data.protocol);

        // Normalize code
        let code = data.code;
        if (!code.startsWith("0x") && !code.startsWith("0X"))
            code = "0x" + code;
        code = BigInt(code);

        // Setup packet
        const packet = Buffer.alloc(17);
        packet.writeUInt16LE(commandSendIrCode, 0);
        packet.writeUInt16LE(data.deviceIndex ?? 0, 2);
        packet.writeUInt32LE(protocol, 4);
        writeU64LE(packet, code, 8);
        packet.writeUInt8(data.repeat ? 1 : 0, 16);
        
        // Send it...
        return irtxSendPacket(packet);
    }

    if (!Array.isArray(data))
    {

        // Get gap from last space
        let gap = data[data.length - 1];

        // Build packet header
        const packet = Buffer.alloc(12 + (data.length - 1) * 2);
        packet.writeUInt16LE(commandSendIr, 0);
        packet.writeUInt16LE(opts.deviceIndex, 2);
        packet.writeUInt32LE(opts.carrierFrequency, 4);
        packet.writeUInt32LE(gap, 8);

        // Timing data
        for (let i = 0; i < data.length - 1; i++)
        {
            packet.writeUInt16LE(data[i], 12 + i * 2);
        }

        // Send it....
        return irtxSendPacket(packet);
    }

    throw new Error("Invalid send parameters");
}

// Set cmd=5 packet for the given array of route objects:
//   { srcProtocol, srcCode, dstProtocol, dstCode, dstIp }
// srcCode / dstCode: BigInt or number (64-bit IR code)
// dstIp: IP string, or '0.0.0.0' for local retransmit
// dstProtocol: 0 to suppress
export function irtxSetRoutingTable(table)
{
    const ENTRY_SIZE = 28;
    const buf = Buffer.alloc(4 + routes.length * ENTRY_SIZE);
    buf.writeUInt16LE(5,             0);  // cmd
    buf.writeUInt16LE(routes.length, 2);  // count

    let offset = 4;
    for (const r of routes) 
    {
        buf.writeUInt32LE(r.srcProtocol,       offset);      offset += 4;
        writeU64LE(buf, r.srcCode, offset);                  offset += 8;
        buf.writeUInt32LE(r.dstProtocol ?? 0,  offset);      offset += 4;
        writeU64LE(buf, r.dstCode ?? 0n, offset);            offset += 8;
        writeIPv4(buf, r.dstIp ?? '0.0.0.0', offset);        offset += 4;
    }

    return irtxSendPacket(buf);
}

// Connect to a BLE Device
// slot - the device to connect (-1 to disconnect all)
export function irtxBleConnect(slot)
{
    // 2 = BLE connect command
    return irtxSendPacket([commandBleConnect, 0, slot < 0 ? 255 : slot])
}

export function irtxBleSendHid(slot, reportId, reportData)
{
    // 3 = BLE
    return irtxSendPacket([commandBleSendHid, 0, slot, reportId, ...reportData]);
}


