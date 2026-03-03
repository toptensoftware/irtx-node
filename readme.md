# irtx-node

Node library for [irtx](https://github.com/toptensoftware/irtx)

## Installation

```bash
npm install --save toptensoftware/irtx-node
```

## Usage

```js
import { protocolNec, irtx_open, irtx_close, irtx_send } from "@toptensoftware/irtx-node";

// Open device
irtx_open("10.1.1.187");

// Send code
await irtx_send(0x12345678, { protocol: protocolNec, repeat: false });

// Close device
irtx_close();
```



## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.