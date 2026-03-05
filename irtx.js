import dgram from "node:dgram";
import { generateIrTiming } from "./irlib.js";

const commandSendIr = 1;
const commandBleConnect = 2;
const commandBleSendHid = 3;

// Currently open irtx device
let ESP32_IP = null;
let UDP_PORT = null;
let sock = null;

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

// Send an ircode
// data = array of timing data 
// opts.deviceIndex (default 0)
// opts.carrierFrequency (default 38000)
export function irtxIrSend(data, opts)
{
    // Resolve options
    opts = Object.assign({
        deviceIndex: 0,
        carrierFrequency: 38000,
    }, opts);

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
    return new Promise((resolve, reject) =>
    {
        sock.send(packet, UDP_PORT, ESP32_IP, (err) =>
        {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}

function sendPacket(pkt)
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



// Connect to a BLE Device
// slot - the device to connect (-1 to disconnect all)
export function irtxBleConnect(slot)
{
    // 2 = BLE connect command
    return sendPacket([commandBleConnect, 0, slot < 0 ? 255 : slot])
}

export function irtxBleSendHid(slot, reportId, reportData)
{
    // 3 = BLE
    return sendPacket([commandBleSendHid, 0, slot, reportId, ...reportData]);
}


export const irtxHidReportId = {
    keyboard: 1,
    consumer: 2,
    mouse: 3,
}