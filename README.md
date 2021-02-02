# serialport Helper

## Installation
```bash
npm install @iqrok/serial.helper
```

## Usage
```javascript
const serialHelper = require('@iqrok/serial.helper');
const serial = new serialHelper(
    port: '/dev/ttyUSB0',
    baud: 9600,

    // reconnect when connection is lost
    // if left undefined will be set to true
    autoreconnect: true,

    // interval, in millisecond, between reconnect attempt
    reconnectInterval: 3000, 

    // open port when creating instance 
    // if left undefined will be set to true
    autoopen: true,
);
```