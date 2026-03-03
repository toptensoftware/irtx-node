import dgram from "node:dgram";


function hexToBits(hexCode, numBits) {

    if (!numBits)
        return [];

    // Convert number to hex
    if (typeof(hexCode) == 'number')
        hexCode = hexCode.toString(16);

    // Remove 0x prefix if present
    let hex = hexCode.toLowerCase();
    if (hex.startsWith('0x')) {
        hex = hex.slice(2);
    }

    const bits = [];

    // Convert each hex digit to 4 bits
    for (const digit of hex) {
        const value = parseInt(digit, 16);
        bits.push((value >> 3) & 1);
        bits.push((value >> 2) & 1);
        bits.push((value >> 1) & 1);
        bits.push(value & 1);
    }

    // Pad with leading zeros or trim to match numBits
    if (bits.length < numBits) {
        const padding = new Array(numBits - bits.length).fill(0);
        return [...padding, ...bits];
    } else if (bits.length > numBits) {
        return bits.slice(bits.length - numBits);
    }

    return bits;
}

function generatePulses(bits, onePulse, zeroPulse)
{
    let r = [];
    for (let bit of bits)
    {
        if (bit)
            r.push(...onePulse);
        else
            r.push(...zeroPulse);
    }
    return r;
}    

/*
* protocol.bitCount = number of bits
* protocol.header = [ pulse, space ]
* protocol.footer = [ pulse, space ]
* protocol.one = [ pulse, space ]
* protocol.zero = [ pulse, space ]
* protocol.repeat = [ pulse, space ... ]
* protocol.length = optional, const length in us
*/
export function generateIrTiming(protocol, code, repeat)
{
    if (repeat && protocol.repeat)
        return protocol.repeat;

    let bits = hexToBits(code, protocol.bitCount);

    let result = [...protocol.header, ...generatePulses(bits, protocol.one, protocol.zero), ...protocol.footer];

    if (protocol.length !== undefined)
    {
        let dataLen = result.reduce((a, b) => a + b, 0);
        if (dataLen < protocol.length)
            result.push(protocol.length - dataLen);
    }

    return result;

}

export let protocolNec = {
    bitCount: 32,
    length: 108000,
    header: [ 9000, 4500 ],
    footer: [ 560 ],
    one: [ 560, 2250 ],
    zero: [ 560, 1125 ],
    repeat: [ 9000, 2250, 560, 108000-9000-2250-560 ]
}

export let protocolPana = { 
    bitCount: 48,
    header: [ 3500, 1750 ],
    footer: [ 435 ],
    one: [ 435, 1300 ],
    zero: [ 435, 435 ],
}


// Currently open irtx device
let ESP32_IP = null;
let UDP_PORT = null;
let sock = null;

// Open irtx for transmit
export function irtx_open(ipaddress, port = 4210)
{
    if (sock)
        throw new Error("Already open");

    ESP32_IP = ipaddress;
    UDP_PORT = port;
    sock = dgram.createSocket("udp4");
}

// Close irtx device
export function irtx_close()
{
    if (sock)
    {
        sock.close();
        sock = null;
    }
}

// Send an ircode
// data = array of timing data or a ir code (string or number) (requires opts.protocol to be set)
// opts.deviceIndex (default 0)
// opts.carrierFrequency (default 38000)
// opts.protocol (default null) Used if data is not a timing data array.
// opts.repeat (default false)
export function irtx_send(data, opts)
{
    // Resolve options
    opts = Object.assign({
        deviceIndex: 0,
        carrierFrequency: 38000,
        repeat: false
    }, opts);

    // Generate timing?
    if (!Array.isArray(data))
    {
        data = generateIrTiming(opts.protocol, data, opts.repeat)
    }

    // Get gap from last space
    let gap = data[data.length - 1];

    // Build packet header
    const packet = Buffer.alloc(12 + (data.length - 1) * 2);
    const command = 1;
    packet.writeUInt16LE(command, 0);
    packet.writeUInt16LE(opts.deviceIndex, 2);
    packet.writeUInt32LE(opts.carrierFrequency, 4);
    packet.writeUInt32LE(gap, 8);

    // Timing data
    for (let i=0; i<data.length - 1; i++)
    {
        packet.writeUInt16LE(data[i], 12 + i * 2);
    }

    // Send it....
    return new Promise((resolve, reject) => {
        sock.send(packet, UDP_PORT, ESP32_IP, (err) => {
            if (err) 
                reject(err);
            else 
                resolve();
        });
    });
}



