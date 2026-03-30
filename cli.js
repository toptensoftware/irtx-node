#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { clargs, showPackageVersion, showArgs } from "@toptensoftware/clargs";
import { pack, registerType, registerEnum } from "@toptensoftware/binpack";
import { loadFile, buildCombinedBuffer } from "@toptensoftware/binpack/cli.js";
import { IrtxDevice } from "./irtx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IRTX_BINPACK_URL = "https://raw.githubusercontent.com/toptensoftware/irtx/main/binpack.js";

function showHelp()
{
    console.log("Usage: irtx [options] <command> [args]\n");
    console.log("Commands:");
    showArgs({
        "send <code>":       "Send an IR code (e.g. NEC:0x20DF10EF)",
        "configure <file>":  "Pack a .js or .json activities config file and upload to device (or write .bin if no --host)",
    });
    console.log("\nOptions:");
    showArgs({
        "--host, -h <ip>":    "IP address or hostname of the irtx device (or set IRTX_HOST)",
        "--port, -p <port>":  "UDP port number for send command (default: 4210)",
        "--help":             "Show this help",
        "--version":          "Show version information",
    });
}

let host = process.env.IRTX_HOST ?? null;
let port = 4210;
let command = null;
let commandArgs = [];

const args = clargs();

while (args.next())
{
    switch (args.name)
    {
        case "help":
            showHelp();
            process.exit(0);
            break;

        case "version":
            showPackageVersion(path.join(__dirname, "package.json"));
            process.exit(0);
            break;

        case "h":
        case "host":
            host = args.readValue();
            break;

        case "p":
        case "port":
            port = args.readIntValue();
            break;

        case null:
            if (command === null)
                command = args.readValue();
            else
                commandArgs.push(args.readValue());
            break;

        default:
            console.error(`Unknown option: --${args.name}`);
            process.exit(1);
    }
}

if (command === null)
{
    showHelp();
    process.exit(0);
}

switch (command)
{
    case "send":
    {
        if (!host)
        {
            console.error("Error: --host is required (or set the IRTX_HOST environment variable)");
            process.exit(1);
        }
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx send <code>  (e.g. NEC:0x20DF10EF)");
            process.exit(1);
        }
        const device = new IrtxDevice(host, port);
        try
        {
            await device.irSend(commandArgs[0]);
        }
        finally
        {
            device.close();
        }
        break;
    }

    case "configure":
    {
        if (commandArgs.length === 0)
        {
            console.error("Usage: irtx configure <file.js|file.json>");
            process.exit(1);
        }
        await configure(host, commandArgs[0]);
        break;
    }

    default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
}

async function configure(host, dataFile)
{
    // Fetch type definitions from irtx repo
    const typeDefsResponse = await fetch(IRTX_BINPACK_URL);
    if (!typeDefsResponse.ok)
        throw new Error(`Failed to fetch type definitions: ${typeDefsResponse.status} ${typeDefsResponse.statusText}`);
    const typeDefsSource = await typeDefsResponse.text();

    // Register a module hook so activities.js can use:
    //   import { op, riff, opId, ... } from "binpack:types"
    register("./irtx-loader.js", {
        parentURL: import.meta.url,
        data: { source: typeDefsSource },
    });

    // Import type defs through the hook (also caches the module for activities.js)
    const { default: typeDefs } = await import("binpack:types");

    // Register types with binpack
    for (const def of typeDefs)
    {
        if (def.fields)
            registerType(def);
        else if (def.enum)
            registerEnum(def.name, def.enum);
    }

    const rootType = typeDefs.find(x => x.fields)?.name;
    if (!rootType)
        throw new Error("No root type found in type definitions");

    // Load and pack the data file (its "binpack:types" imports are served by the hook)
    const data = await loadFile(dataFile);
    const packResult = pack(rootType, data);
    const buffer = buildCombinedBuffer(packResult);

    if (host)
    {
        // POST to device as multipart upload (matches Arduino WebServer upload handler)
        const form = new FormData();
        form.append("file", new Blob([buffer], { type: "application/octet-stream" }), "activities.bin");

        const postResponse = await fetch(`http://${host}/activities`, {
            method: "POST",
            body: form,
        });

        if (!postResponse.ok)
            throw new Error(`Upload failed: ${postResponse.status} ${postResponse.statusText}`);

        console.log(`Configured: ${buffer.length} bytes uploaded to ${host}`);
    }
    else
    {
        const outFile = path.join(path.dirname(path.resolve(dataFile)),
                                  path.basename(dataFile, path.extname(dataFile)) + ".bin");
        fs.writeFileSync(outFile, buffer);
        console.log(`Written: ${outFile} (${buffer.length} bytes)`);
    }
}
