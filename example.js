const __serial = require('./');

const serial = new __serial({
		port: "/dev/ttyUSB0",
		baud: 19200,
		autoreconnect: true,
		autoopen: true,
		debug: true,
	});

serial.on('open', received => {
	console.log(received);
});

serial.on('close', received => {
	console.log(received);
});

serial.on('data', received => {
	console.log(received);
});

serial.on('error', received => {
	console.error(received);
});
